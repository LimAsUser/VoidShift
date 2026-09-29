const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

let now = 1000;
const events = new Map();
const sandbox = {
  structuredClone, performance: { now: () => now },
  window: { addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); }, matchMedia: () => ({ matches: true }) },
  document: { hidden: false, visibilityState: 'visible', hasFocus: () => true, addEventListener() {}, getElementById: () => null },
  setTimeout: () => 1, clearTimeout() {}
};
for (const name of ['config', 'inventory', 'entities', 'game', 'ui']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'), sandbox);
}
const { Game, Player, BackpackManager, UIManager } = vm.runInNewContext('({Game,Player,BackpackManager,UIManager})', sandbox);
const audio = { context: null, lastStep: 0, playTone() {}, playSound() {}, ensureAudio() {}, update() {} };
function game(role = 'host', count = 2) {
  now = 1000;
  const g = Object.create(Game.prototype);
  g.state = { running: true, elapsed: 0, keys: {}, inventory: [], remoteInventory: [], loot: 0, lootValue: 0,
    bulletTraces: [], impactParticles: [], coop: { running: true, connected: true, role, playerId: role === 'host' ? 'host' : 'guest-1' } };
  g.map = { seed: 1, spawnPoint: { x: 100, y: 100 }, blocked: () => false, rayWallDistance: () => 650,
    getRoomAt: () => null, layoutSignature: () => 'layout', doors: [], scrap: [], terminals: [], worldRooms: [] };
  g.player = new Player(); g.player.reset(g.map);
  g.backpack = BackpackManager.fromType('field'); g.state.inventory = g.backpack.items;
  g.remoteBackpack = BackpackManager.fromType('field');
  g.remotePlayers = new Map();
  for (let slot = 1; slot <= count; slot++) {
    const id = slot === 1 ? 'host' : `guest-${slot - 1}`;
    if (id === g.state.coop.playerId) continue;
    const player = new Player(); player.reset(g.map); player.y += slot * 100;
    const backpack = BackpackManager.fromType('field');
    g.remotePlayers.set(id, { id, slot, player, online: true, status: 'connected', backpack, inventory: backpack.items,
      input: { seq: 0, keys: {}, fire: false }, lastInputAt: now });
  }
  g.monster = {}; g.hunters = []; g.audio = audio;
  g.ui = { updateTerminalsStatus() {}, updateExtractionProgress() {}, updateFlashbangs() {}, updateOxygenStock() {}, update() {}, showToast() {},
    setCoopNetworkStatus(value) { g.warning = value; } };
  g.sent = []; g.coopSession = { sendState(...args) { g.sent.push(args); return 1; }, sendEvent() { return true; } };
  g._save = () => {};
  return g;
}
function input(g, id, seq, keys = { d: true }, fire = false) {
  g._handleCoopMessage('state', { type: 'input', seq, keys, fire, aim: 0, aiming: false }, id);
}

test('stale input stops only that guest within 300ms plus one frame and rejects old sequence refreshes', () => {
  for (const count of [2, 3, 4]) for (const fps of [30, 60, 120]) {
    const g = game('host', count), entry = g.remotePlayers.get('guest-1');
    input(g, 'guest-1', 1);
    let stoppedX;
    for (let frame = 1; frame <= fps; frame++) {
      now = 1000 + frame * 1000 / fps;
      for (const id of g.remotePlayers.keys()) if (id !== 'guest-1') input(g, id, frame);
      if (frame === Math.floor(fps / 2)) input(g, 'guest-1', 1);
      g._updateRemotePlayers(1 / fps);
      if (now > 1300 && stoppedX === undefined) stoppedX = entry.player.x;
    }
    assert.equal(entry.player.x, stoppedX);
    assert.ok(entry.player.x - 100 <= 70 * (0.3 + 1 / fps));
    assert.equal(entry.inputStale, true);
    assert.equal(g.state.coop.hostPaused, undefined);
    for (const [id, other] of g.remotePlayers) if (id !== 'guest-1') assert.ok(other.player.x > entry.player.x);
    input(g, 'guest-1', 2); g._updateRemotePlayers(1 / fps);
    assert.ok(entry.player.x > stoppedX);
  }
});

test('stale fire stops, an in-progress roll completes, and stale rescuers cannot finish a revive', () => {
  const g = game(), entry = g.remotePlayers.get('guest-1');
  entry.player.unlockWeapon('smg'); entry.player.equipWeapon('primary', 'smg'); entry.player.switchWeaponSlot('primary');
  input(g, entry.id, 1, {}, true);
  let shots = 0; g.shoot = () => shots++;
  g._updateRemotePlayers(0.01); assert.equal(shots, 1);
  entry.player.armory.ownedPassives.roll = true; entry.player.armory.equippedPassive = 'roll';
  entry.player.startRoll(1, 0); const start = entry.player.x;
  now = 1301;
  for (let n = 0; n < 8; n++) g._updateRemotePlayers(0.05);
  assert.equal(shots, 1); assert.ok(Math.abs(entry.player.x - start - 100) < 0.001);
  g.player.downed = true; g.player.health = 0; g.player.reviveProgress = 2.99;
  entry.player.x = g.player.x + 25; entry.player.y = g.player.y;
  g.coopReviveAssignments = new Map([['host', entry.id]]);
  g._updateCoopRevive(0.05);
  assert.equal(g.player.downed, true); assert.equal(g.player.reviveProgress, 0);
});

test('20Hz cadence keeps fractional frame time at all caps and never sends a catch-up burst', () => {
  for (const fps of [30, 60, 90, 120, 144]) {
    const g = game(); let sends = 0;
    for (let n = 0; n < fps * 5; n++) if (g._coopSendDue(1 / fps)) sends++;
    assert.ok(sends >= 100 && sends <= 101, `${fps} FPS: ${sends}`);
    assert.equal(g._coopSendDue(10), true);
    assert.equal(g._coopSendDue(0), false);
  }
});

test('canonical snapshots carry each personal inventory once and no legacy duplicates', () => {
  const g = game('host', 4);
  g.backpack.place({ name: 'Host cargo', value: 10, shape: '1x1' });
  g.remotePlayers.get('guest-2').backpack.place({ name: 'Guest cargo', value: 20, shape: '1x1' });
  const snapshot = g._createCoopSnapshot();
  for (const key of ['host', 'guest', 'inventories', 'hostInventory', 'guestInventory']) assert.equal(key in snapshot, false, key);
  assert.equal(snapshot.players.length, 4);
  assert.equal(snapshot.players.find(p => p.id === 'guest-2').inventory[0].name, 'Guest cargo');
});

test('identical inventories cause no redraw, display changes do, and drag/pending protection is retained', () => {
  const g = game('guest'), item = { id: 1, name: 'cargo', value: 25, shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const snapshots = { 'guest-1': [item], host: [] };
  assert.equal(g._applyCoopInventorySnapshot([item], [], snapshots), true);
  for (let n = 0; n < 20; n++) assert.equal(g._applyCoopInventorySnapshot([item], [], snapshots), false);
  const renamed = { ...item, name: 'new name', value: 50 };
  assert.equal(g._applyCoopInventorySnapshot([renamed], [], { ...snapshots, 'guest-1': [renamed] }), true);
  g._itemDrag = {}; assert.equal(g._applyCoopInventorySnapshot([], [], {}), false);
  assert.equal(g.backpack.items.length, 1);
  g._itemDrag = null; g._guestInventoryLayoutPending = true; g._guestInventoryLayoutPendingAt = now;
  assert.equal(g._applyCoopInventorySnapshot([], [], {}), false);
  now += 1501; assert.equal(g._applyCoopInventorySnapshot([], [], {}), true);
  assert.equal(g.backpack.items.length, 0);
});

test('hidden inventory defers DOM rebuilding', () => {
  const g = game('guest'); let lookups = 0;
  const previous = sandbox.document.getElementById;
  sandbox.document.getElementById = () => { lookups++; return null; };
  g.updateInventoryUI();
  assert.equal(lookups, 0); assert.equal(g._inventoryUiDirty, true);
  sandbox.document.getElementById = previous;
});

test('remote display interpolates with 100ms delay without moving authoritative coordinates', () => {
  const g = game('guest'), entry = g.remotePlayers.get('host');
  g._recordRemotePose(entry, { x: 100, y: 100, angle: Math.PI - 0.1 }, true);
  now = 1050; g._recordRemotePose(entry, { x: 110, y: 100, angle: -Math.PI + 0.1 });
  entry.player.x = 110; entry.player.y = 100; entry.player.angle = -Math.PI + 0.1; entry.player.downed = true;
  now = 1125;
  const display = g._coopRenderPlayers()[0].player;
  assert.equal(display.x, 105); assert.ok(Math.abs(Math.abs(display.angle) - Math.PI) < 0.001);
  assert.equal(display.downed, true); assert.equal(entry.player.x, 110);
  now = 1400; assert.equal(g._coopRenderPlayers()[0].player.x, 110);
  g._recordRemotePose(entry, { x: 300, y: 100, angle: 0 }); entry.player.x = 300;
  assert.equal(g._coopRenderPlayers()[0].player.x, 300);
});

test('network warning is delayed, suppressed on host pause and cleared by fresh snapshots', () => {
  const g = game('guest'); g.state.coop.lastSnapshotAt = 1000;
  now = 1500; g._updateCoopNetworkStatus(); assert.equal(g.warning, false);
  now = 1501; g._updateCoopNetworkStatus(); assert.equal(g.warning, true);
  g.state.coop.hostPaused = true; g._updateCoopNetworkStatus(); assert.equal(g.warning, false);
  g.state.coop.hostPaused = false; g.state.coop.lastSnapshotAt = now;
  g._updateCoopNetworkStatus(); assert.equal(g.warning, false);
  const ui = Object.create(UIManager.prototype); ui.hudNetworkStatus = { hidden: true };
  ui.setCoopNetworkStatus(true); assert.equal(ui.hudNetworkStatus.hidden, false);
  ui.setCoopNetworkStatus(false); assert.equal(ui.hudNetworkStatus.hidden, true);
});

function bindControls(g) {
  events.clear(); const node = { addEventListener() {}, classList: { remove() {} } };
  sandbox.document.getElementById = () => node;
  Object.assign(g.ui, { startButton: node, prompt: node, settingsSectionButtons: [], difficultyButtons: {}, hunterSettingInputs: [], finalTerminalSettingInputs: {} });
  g.attachEventListeners();
  return (name, event = {}) => { for (const fn of events.get(name) || []) fn({ preventDefault() {}, ...event }); };
}

test('keyup, pointer release and blur send neutral guest inputs immediately; E/B/M never repeat', () => {
  const g = game('guest'), emit = bindControls(g);
  g.state.keys = { d: true }; emit('keyup', { key: 'd' });
  assert.equal(g.sent.length, 1); assert.equal(g.sent[0][1].keys.d, false);
  g.state.fireHeld = true; emit('pointerup', { button: 0, buttons: 0 });
  assert.equal(g.sent.length, 2); assert.equal(g.sent[1][1].fire, false);
  g.state.keys.d = true; g.state.fireHeld = true; emit('blur');
  assert.equal(g.sent.length, 3); assert.equal(g.sent[2][1].keys.d, false); assert.equal(g.sent[2][1].fire, false);
  let maps = 0, bags = 0, interacts = 0;
  g.state.coop.role = 'host'; g.interact = () => interacts++; g.toggleFullMap = () => maps++; g.toggleInventory = () => bags++;
  for (const key of ['e', 'b', 'm']) { emit('keydown', { key, repeat: false }); emit('keydown', { key, repeat: true }); }
  assert.equal(interacts, 1); assert.equal(maps, 1); assert.equal(bags, 1);
});

test('2-4 players tolerate 80/150ms delay, loss and reordering; a single silent guest stops independently', () => {
  for (const count of [2, 3, 4]) for (const delay of [80, 150]) for (const fps of [30, 60, 120]) {
    const g = game('host', count), pending = [];
    let nextSend = 0, seq = 0, frozenAt = null;
    const faulted = g.remotePlayers.get('guest-1');
    for (let frame = 0; frame < fps * 3; frame++) {
      const elapsed = frame * 1000 / fps;
      now = 1000 + elapsed;
      while (nextSend <= elapsed) {
        seq++;
        for (const id of g.remotePlayers.keys()) {
          if (id === 'guest-1' && nextSend >= 800 && nextSend < 1800) continue;
          if (seq % 10 === 0) continue;
          pending.push({ id, seq, at: 1000 + nextSend + delay + (seq % 7 === 0 ? 120 : 0) });
        }
        nextSend += 50;
      }
      pending.sort((a, b) => a.at - b.at);
      while (pending[0]?.at <= now) {
        const packet = pending.shift(); input(g, packet.id, packet.seq);
      }
      g._updateRemotePlayers(1 / fps);
      if (elapsed >= 1400 && elapsed < 1700) {
        frozenAt ??= faulted.player.x;
        assert.equal(faulted.player.x, frozenAt, `${count}/${delay}/${fps}`);
      }
    }
    assert.ok(faulted.player.x > frozenAt);
    for (const [id, peer] of g.remotePlayers) if (id !== 'guest-1') assert.ok(peer.player.x > faulted.player.x);
  }
});

test('canonical guest snapshots apply inventory changes once while remote gameplay state is immediate', () => {
  const host = game('host', 4), guest = game('guest', 4);
  host.remotePlayers.get('guest-1').backpack.place({ name: 'oxygen', shape: '1x2', effect: 'oxygen-50', value: 250 });
  let redraws = 0; guest.updateInventoryUI = () => redraws++;
  guest._applyCoopSnapshot(host._createCoopSnapshot());
  assert.equal(guest.backpack.items.length, 1); assert.equal(redraws, 1);
  const selected = guest.backpack.items[0]; guest.selectedItemId = selected.id;
  for (let n = 0; n < 20; n++) guest._applyCoopSnapshot(host._createCoopSnapshot());
  assert.equal(redraws, 1); assert.equal(guest.backpack.items[0], selected);
  now += 50; host.player.x += 10; host.player.downed = true;
  guest._applyCoopSnapshot(host._createCoopSnapshot());
  assert.equal(guest.remotePlayers.get('host').player.x, host.player.x);
  assert.equal(guest._coopRenderPlayers().find(entry => entry.id === 'host').player.downed, true);
  host.remotePlayers.get('guest-1').backpack.clear();
  guest._applyCoopSnapshot(host._createCoopSnapshot());
  assert.equal(guest.backpack.items.length, 0); assert.equal(redraws, 2);
});

test('host pause and rejoin discard old motion display samples and neutralize input', () => {
  const g = game('guest'), entry = g.remotePlayers.get('host');
  g._recordRemotePose(entry, entry.player, true);
  now += 50; entry.player.x += 10; g._recordRemotePose(entry, entry.player);
  g.state.keys.d = true; g.state.fireHeld = true;
  g._setCoopPauseState(true); assert.equal(entry.renderSamples.length, 1);
  assert.equal(g.state.fireHeld, false); assert.equal(Object.keys(g.state.keys).length, 0);
  g._setCoopPauseState(false);
  assert.equal(g._coopRenderPlayers()[0].player.x, entry.player.x);
  const host = game(); host.state.elapsed = 5;
  g._handleCoopMessage('events', { type: 'rejoin-state', snapshot: host._createCoopSnapshot() });
  assert.equal(entry.renderSamples.length, 1); assert.equal(g._lastSnapshotTick, 5000);
  assert.equal(g.sent[g.sent.length - 1][1].fire, false);
});

test('opening guest operation menus immediately neutralizes movement and fire', () => {
  for (const menu of ['togglePauseMenu', 'toggleFullMap', 'toggleInventory']) {
    const g = game('guest');
    const node = { style: {}, classList: { remove() {}, add() {} } };
    sandbox.document.getElementById = () => node;
    g.ui.log = () => {}; g.renderer = { drawFullMap() {} };
    g.updateInventoryUI = () => {};
    g.state.keys.d = true; g.state.fireHeld = true;
    g[menu](true);
    assert.equal(g.sent.length, 1, menu);
    assert.equal(g.sent[0][1].keys.d, false); assert.equal(g.sent[0][1].fire, false);
  }
});

test('picking up a flashbang updates HUD stock even while the inventory grid is hidden', () => {
  const g = game(); g.state.flashbangCount = 0; g.ui.log = () => {};
  let shown = 0; g.ui.updateFlashbangs = count => { shown = count; };
  g.map.scrap = [{ id: 1, x: g.player.x, y: g.player.y, name: 'flashbang', effect: 'flashbang', shape: '1x1', value: 250 }];
  g.collect();
  assert.equal(g.backpack.items.length, 1);
  assert.equal(g.state.flashbangCount, 1);
  assert.equal(shown, 1);
});

test('invalid normal/rejoin snapshots cannot poison freshness or block later valid synchronization', () => {
  const g = game('guest'), host = game();
  g._lastSnapshotTick = 100; g.state.coop.lastSnapshotAt = 1000;
  now = 1200;
  g._handleCoopMessage('events', { type: 'rejoin-state', snapshot: { players: [] } });
  assert.equal(g._lastSnapshotTick, 100); assert.equal(g.state.coop.lastSnapshotAt, 1000);
  g._handleCoopMessage('state', { type: 'snapshot', tick: 9999, players: [] });
  assert.equal(g._lastSnapshotTick, 100); assert.equal(g.state.coop.lastSnapshotAt, 1000);
  host.state.elapsed = 1;
  g._handleCoopMessage('state', { type: 'snapshot', ...host._createCoopSnapshot() });
  assert.equal(g._lastSnapshotTick, 1000); assert.equal(g.state.coop.lastSnapshotAt, 1200);
});

test('equivalent reordered item properties converge without repeated inventory refreshes', () => {
  const g = game('guest');
  const item = { id: 1, name: 'cargo', value: 25, gx: 0, gy: 0, rot: 0, shape: '1x1' };
  g._applyCoopInventorySnapshot([item], [], {});
  const reordered = Object.fromEntries(Object.entries(item).reverse());
  for (let n = 0; n < 3; n++) assert.equal(g._applyCoopInventorySnapshot([reordered], [], {}), false);
});
