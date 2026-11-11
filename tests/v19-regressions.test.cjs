const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: { addEventListener() {} }, structuredClone, performance };
for (const name of ['config', 'inventory', 'map', 'entities', 'corpses', 'equipment', 'loot', 'renderer', 'game']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
}
const { Game, Monster, BackpackManager, Config, MapManager, EquipmentController, CorpseEffects, Renderer, LootController } = vm.runInNewContext('({ Game, Monster, BackpackManager, Config, MapManager, EquipmentController, CorpseEffects, Renderer, LootController })', context);

test('a flash-stunned sleeping Nightmare still reports its sleep time', () => {
  const monster = new Monster();
  monster.active = true;
  monster.recoverTimer = 20;
  monster.applyFlashStun(5);
  const result = monster.update(0.05, { x: 0, y: 0, noise: 0 }, 0, null, null, null);
  assert.equal(result.recovering, true);
  assert.ok(Number.isFinite(result.recoverTimeLeft));
});

test('host rejects an unusable supply request explicitly and accepts the next bottle', () => {
  const game = Object.create(Game.prototype);
  const player = { oxygen: 45, health: 90 };
  const backpack = BackpackManager.fromType('field');
  const entry = { id: 'guest-1', online: true, player, backpack, lastSupplyRequestId: 0 };
  game.remotePlayers = new Map([['guest-1', entry]]);
  game.state = { running: true, elapsed: 0, missionFxId: 'mission-1', coop: { role: 'host' } };
  const sent = [];
  game.coopSession = { sendEvent: (type, payload) => { sent.push({ type, payload }); return true; } };
  game._backpackFor = () => backpack;
  game._handleRemoteAction({ action: 'use-supply', itemId: 'missing', requestId: 1, missionId: 'mission-1' }, 'guest-1');
  assert.deepEqual(sent.at(-1).type, 'supply-result');
  assert.equal(sent.at(-1).payload.accepted, false);
  backpack.place({ id: 'bottle-2', effect: 'oxygen-50', shape: '1x2' });
  game._handleRemoteAction({ action: 'use-supply', itemId: 'bottle-2', requestId: 2, missionId: 'mission-1' }, 'guest-1');
  assert.equal(sent.at(-1).payload.accepted, true);
  assert.equal(player.supplyUse.itemId, 'bottle-2');
});

test('a rejected Guest supply request clears its wait state', () => {
  const game = Object.create(Game.prototype);
  game.state = { missionFxId: 'mission-1', coop: { role: 'guest' } };
  game._pendingSupplyRequest = { requestId: 4 };
  const toasts = [];
  game.ui = { showToast: message => toasts.push(message) };
  assert.equal(game._applySupplyResult({ missionId: 'mission-1', requestId: 4, accepted: false, reason: 'missing-item' }), true);
  assert.equal(game._pendingSupplyRequest, null);
  assert.equal(toasts.length, 1);
});

test('a snapshot acknowledgment does not hide an explicit supply rejection', () => {
  const game = Object.create(Game.prototype);
  game.state = { missionFxId: 'mission-1', coop: { role: 'guest' } };
  game.player = { x: 0, y: 0, angle: 0 };
  game._pendingSupplyRequest = { requestId: 4, payload: { itemId: 'missing' } };
  const toasts = [];
  game.ui = { showToast: message => toasts.push(message) };
  game._applyPlayerSnapshot(game.player, { x: 0, y: 0, angle: 0, lastSupplyRequestId: 4, supplyUse: null });
  assert.equal(game._pendingSupplyRequest.requestId, 4);
  assert.equal(game._applySupplyResult({ missionId: 'mission-1', requestId: 4, accepted: false, reason: 'missing-item' }), true);
  assert.equal(toasts.length, 1);
});

test('an older use of the same bottle cannot acknowledge a rejected second request', () => {
  const game = Object.create(Game.prototype);
  game.state = { missionFxId: 'mission-1', coop: { role: 'guest' } };
  game.player = { x: 0, y: 0, angle: 0 };
  game._pendingSupplyRequest = { requestId: 5, payload: { itemId: 'bottle-a' } };
  game.ui = { showToast() {} };
  game._applyPlayerSnapshot(game.player, { x: 0, y: 0, angle: 0, lastSupplyRequestId: 5,
    supplyUse: { itemId: 'bottle-a', endsAt: 2 } });
  assert.equal(game._pendingSupplyRequest.requestId, 5);
  assert.equal(game._applySupplyResult({ missionId: 'mission-1', requestId: 5, accepted: false, reason: 'busy' }), true);
});

test('difficulty V19 encounters match the requested HP, counts and Nightmare damage', () => {
  const rows = {
    easy: { hunter: [10, 16, 24], hp: 2, heavy: [1, 2, 3], heavyHp: 5, nightmare: [0, 0, 0] },
    medium: { hunter: [10, 16, 24], hp: 2, heavy: [2, 3, 4], heavyHp: 5,
      nightmare: [1, 2, 3], nightmareHp: 1, sleep: 40, wallSpeed: 10, damage: 0.02 },
    hard: { hunter: [20, 32, 46], hp: 3, heavy: [3, 4, 5], heavyHp: 10,
      nightmare: [2, 3, 4], nightmareHp: 1, sleep: 30, wallSpeed: 20, damage: 0.03 }
  };
  for (const [difficulty, row] of Object.entries(rows)) {
    const rules = Config.encounterRules[difficulty];
    for (const [index, scale] of ['small', 'medium', 'large'].entries()) {
      assert.equal(Config.difficultyPresets[difficulty].maps[scale].hunters, row.hunter[index]);
      assert.equal(Config.difficultyPresets[difficulty].maps[scale].hunterMaxHp, row.hp);
      assert.equal(rules.heavyCounts[index], row.heavy[index]);
      assert.equal(rules.nightmareCounts[index], row.nightmare[index]);
    }
    assert.equal(rules.heavyHp, row.heavyHp);
    if (difficulty !== 'easy') {
      assert.equal(rules.nightmareHp, row.nightmareHp);
      assert.equal(rules.nightmareSleep, row.sleep);
      assert.equal(rules.nightmareWallSpeed, row.wallSpeed);
      assert.equal(rules.nightmareDamage, row.damage);
      assert.equal(rules.nightmareOxygenDamage, 0);
    }
  }
});

test('easy maps contain Hunter and Heavy, never Nightmare', () => {
  const map = new MapManager('small', 123456, 'easy');
  assert.deepEqual([...map.enemyTypes].sort(), ['heavy', 'hunter']);
});

test('Nightmare fractional HP damage leaves oxygen untouched', () => {
  for (const [difficulty, loss] of [['medium', 0.02], ['hard', 0.03]]) {
    const game = Object.create(Game.prototype);
    game.state = { selectedDifficulty: difficulty, elapsed: 0, coop: {} };
    const actor = { health: 100, oxygen: 100 };
    const settings = game._getEncounterSettings('small');
    game._applyDamage(actor, settings.nightmareDamage, settings.nightmareOxygenDamage);
    assert.ok(Math.abs(actor.health - (100 - loss)) < 1e-9);
    assert.equal(actor.oxygen, 100);
  }
});

test('machine gun fires every 0.1 seconds with aimed spread at one fifth of hip spread', () => {
  const weapon = Config.weapons.machinegun;
  assert.equal(weapon.shootCooldownDuration, 0.1);
  assert.ok(Math.abs(weapon.aimSpread - weapon.hipSpread * 0.2) < 1e-12);
});

test('barrier blueprints are 64 by 32 in both free and doorway placement', () => {
  const actor = { x: 100, y: 100, radius: 10 };
  const game = { state: { missionFxId: 'm', coop: {} },
    map: { doors: [{ x: 155, y: 70, w: 128, h: 24 }], terminals: [],
      blocked: () => false, rayWallDistance: () => Infinity },
    _onlineCoopPlayers: () => [actor] };
  const equipment = new EquipmentController(game);
  for (const vertical of [false, true]) {
    const free = equipment.blueprint(actor, 130, 200, vertical);
    const snapped = equipment.blueprint(actor, 219, 82, vertical);
    assert.deepEqual([Math.max(free.w, free.h), Math.min(free.w, free.h)], [64, 32]);
    assert.deepEqual([Math.max(snapped.w, snapped.h), Math.min(snapped.w, snapped.h)], [64, 32]);
    assert.equal(free.vertical, vertical);
    assert.equal(snapped.vertical, vertical);
  }
});

test('an alerted monster attacks an adjacent blocking barrier even if the player is elsewhere', () => {
  const actor = { x: 100, y: 100, radius: 10 };
  const game = { state: { missionFxId: 'm', coop: {} },
    map: { doors: [], terminals: [], blocked: () => false, rayWallDistance: () => Infinity },
    _onlineCoopPlayers: () => [actor] };
  const equipment = new EquipmentController(game);
  game.state.barriers = [{ id: 'b', x: 125, y: 85, w: 64, h: 32, hp: 20 }];
  equipment.reindex();
  const monster = { x: 100, y: 100, radius: 22.5, active: true, alerted: true, attackCooldown: 0 };
  equipment.attackObstacle(monster, { x: 100, y: 300, radius: 10 }, 0.3, 'monster');
  assert.equal(game.state.barriers[0].hp, 19);
});

test('corpse fragment motion is local on host and Guest without pose events', () => {
  for (const role of ['host', 'guest']) {
    const game = Object.create(Game.prototype);
    game.state = { missionFxId: 'm', coop: { running: true, role } };
    game.map = { blocked: () => false };
    game.player = { x: 0, y: 0, radius: 10 };
    game.remotePlayers = new Map([['peer', { id: 'peer', online: true, equipmentSyncing: false }]]);
    game._onlineCoopPlayers = () => [game.player];
    const sent = [];
    game.coopSession = { peers: new Map([['peer', { eventChannel: { bufferedAmount: 0 } }]]),
      sendEvent: (type) => { sent.push(type); return true; } };
    game._clearEnemyEffects();
    const body = { id: 'body', kind: 'hunter', seed: 42, width: 63, x: 100, y: 100, angle: 0 };
    CorpseEffects.initialize(body, game.map);
    game.corpseRegistry = [body];
    game._rebuildCorpseGrid();
    const piece = body.fragments[0];
    piece.vx = 30;
    piece.sleeping = false;
    game.corpseActive.add(body);
    const before = piece.x;
    game._updateCorpsePhysics(0.1);
    assert.notEqual(piece.x, before, role);
    assert.equal(sent.includes('corpse-motion'), false, role);
  }
});

test('low quality switches immediately, persists locally and avoids high-resolution enemy sprites', () => {
  const classes = new Set();
  context.document = { body: { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } } };
  const game = Object.create(Game.prototype);
  game.state = { textureQuality: 'high' };
  game.renderer = { roomCaches: new WeakMap(), bulkheadPattern: {}, clearCorpseTextures() {} };
  game.ui = { updateTextureQuality(value) { assert.equal(value, 'low'); } };
  game._save = () => true;
  assert.equal(game.setTextureQuality('low'), true);
  assert.equal(classes.has('low-quality'), true);
  assert.equal(game.state.textureQuality, 'low');

  const renderer = Object.create(Renderer.prototype);
  renderer.lowQuality = true;
  renderer.sprite = () => { throw Error('low-quality mode must not load a sprite'); };
  const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {}, arc() {} };
  assert.equal(renderer.drawEnemyBody(ctx, 'heavy', 112), true);
});

test('double-clicking the same item transfers once; a different item or drag does not', () => {
  const loot = Object.create(LootController.prototype);
  const tap = (kind, id, x, y, timeStamp) => loot._isDoubleTap(kind, id, { clientX: x, clientY: y, timeStamp });
  assert.equal(tap('crate', 'a', 20, 30, 1000), false);
  assert.equal(tap('crate', 'b', 20, 30, 1100), false);
  assert.equal(tap('crate', 'b', 23, 32, 1200), true);
  assert.equal(tap('crate', 'b', 23, 32, 1250), false);
  assert.equal(tap('bag', 'b', 23, 32, 1300), false);
});
