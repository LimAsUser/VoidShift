const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fixtureFactory(file, name) {
  const context = vm.createContext({ require, __dirname, setImmediate, structuredClone,
    EventTarget, Event, MessageEvent, CustomEvent, DOMException, URL, URLSearchParams,
    TextEncoder, TextDecoder, Uint8Array, AbortController, btoa, atob, queueMicrotask,
    crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval });
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8').split('\ntest(')[0];
  vm.runInContext(`${source}\nglobalThis.makeFixture = ${name};`, context);
  return context.makeFixture;
}

const rewardFixture = fixtureFactory('game-rewards-v16.test.cjs', 'fixture');
const lanFixture = fixtureFactory('lan-client-v20.test.cjs', 'setup');
const EquipmentController = vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '../js/equipment.js'), 'utf8')}\nEquipmentController;`,
  { structuredClone, performance: { now: () => 1000 } }
);

function room(count) {
  const ids = ['host', ...Array.from({ length: count - 1 }, (_, index) => `guest-${index + 1}`)];
  const games = new Map(), queue = [], work = [], frames = [], sequences = new Map();
  for (const [index, id] of ids.entries()) {
    const fixture = rewardFixture(), game = fixture.g;
    const session = new (lanFixture({ mode: 'online' }).classes.LanCoopSession)();
    Object.assign(session, { memberId: id, localSlot: index + 1, roomCode: 'ABC234',
      role: id === 'host' ? 'host' : 'guest', connected: true });
    game.state.coop = { role: session.role, running: true, connected: true, playerId: id,
      localSlot: index + 1, members: ids.slice(1).map((memberId, slot) => ({
        id: memberId, slot: slot + 2, status: 'connected', connected: true
      })) };
    Object.assign(game.state, { keys: {}, fireHeld: false, elapsed: 0, missionFxId: `lan-gameplay-${count}` });
    Object.assign(game.map, { seed: 1, spawnPoint: { x: 100, y: 100 }, doors: [], worldRooms: [],
      rayWallDistance: () => 650, getRoomAt: () => null, layoutSignature: () => 'lan-gameplay-layout' });
    game.player.reset(game.map);
    game.backpack.clear(); game.state.inventory = game.backpack.items;
    for (const [slot, remoteId] of ids.entries()) {
      if (remoteId === id) continue;
      const player = new fixture.Player(); player.reset(game.map); player.y += slot * 100;
      const backpack = new game.backpack.constructor(8, 5);
      game.remotePlayers.set(remoteId, { id: remoteId, slot: slot + 1, player, backpack,
        inventory: backpack.items, online: true, status: 'connected',
        input: { seq: 0, keys: {}, fire: false }, lastInputAt: 1000 });
    }
    game.defeatLedger = new game.defeatLedger.constructor(game.state.missionFxId, ids);
    game.pendingCoopFinishes = new Map();
    game.equipment = new EquipmentController(game);
    game._broadcastCoopRoster = () => {};
    game.coopSession = session;
    const handle = game._handleCoopMessage;
    game._handleCoopMessage = (...args) => {
      const pending = handle.apply(game, args); work.push(pending); return pending;
    };
    game._attachCoopSession();
    for (const channel of ['state', 'events']) {
      session._sockets[channel] = { readyState: 1, bufferedAmount: 0,
        send(data) {
          const frame = JSON.parse(data);
          if (frame.kind !== 'data') return;
          frames.push({ fromId: id, channel, ...frame });
          const targets = id === 'host' ? ids.slice(1).filter(target => !frame.targetId || target === frame.targetId) : ['host'];
          for (const targetId of targets) {
            const key = `${targetId}:${channel}:${id}`, seq = (sequences.get(key) || 0) + 1;
            sequences.set(key, seq);
            queue.push({ targetId, channel, frame: { ...frame, fromId: id, seq } });
          }
        }, close() { this.readyState = 3; } };
    }
    fixture.storage.set('voidshift_save', JSON.stringify({ money: 1000, rewardCreditsTotal: 0,
      profileMissions: { [game.state.missionFxId]: { difficulty: 'medium', outcome: null, context: {} } } }));
    games.set(id, { ...fixture, game, session });
  }
  for (const [id, { session }] of games) {
    for (const [slot, peerId] of ids.entries()) {
      if (peerId === id || id !== 'host' && peerId !== 'host') continue;
      session.peers.set(peerId, { id: peerId, slot: slot + 1, connected: true,
        stateChannel: session._sockets.state, eventChannel: session._sockets.events });
    }
  }
  const host = games.get('host').game;
  return { ids, games, host, frames,
    async drain() {
      for (let turn = 0; turn < 30; turn++) {
        while (queue.length) {
          const { targetId, channel, frame } = queue.shift(), target = games.get(targetId).session;
          target._receive(channel, target._sockets[channel], JSON.stringify(frame));
        }
        await Promise.all(work.splice(0));
        await Promise.all([...games.values()].map(fixture => fixture.settled()));
        if (!queue.length && !work.length) return;
      }
      throw new Error('LAN fixture did not settle');
    },
    snapshot() { host.state.elapsed += 0.05; return host.coopSession.sendState('snapshot', host._createCoopSnapshot()); },
    close() { for (const { game, session } of games.values()) { game._detachCoopSession(); session.close(false); } }
  };
}

function oxygen(id) {
  return { id, name: 'oxygen', shape: '1x2', type: 'consumable', effect: 'oxygen-50', value: 150 };
}

for (const count of [2, 3, 4]) {
  test(`${count} LAN players transfer chest and teammate oxygen, with host-only consumption`, async () => {
    const r = room(count), targetId = r.ids.at(-1), target = r.games.get(targetId).game;
    try {
      const remote = r.host.remotePlayers.get(targetId);
      Object.assign(remote.player, { x: 100, y: 100, oxygen: 20 });
      const otherOxygen = new Map();
      for (const [id, entry] of r.host.remotePlayers) {
        if (id === targetId) continue;
        entry.player.oxygen = 35 + entry.slot;
        otherOxygen.set(id, entry.player.oxygen);
      }
      r.host.map.containers.push({ id: 'chest', x: 100, y: 100, fixed: true, revision: 0, items: [oxygen('chest-oxygen')] });
      r.host.loot.broadcastBox('chest'); r.snapshot(); await r.drain();
      target.state.lootContainerId = 'chest';
      assert.equal(target.loot.request('take', 'chest-oxygen'), true);
      await r.drain();
      assert.equal(target.backpack.items[0].id, 'chest-oxygen');
      assert.equal(r.host.map.containers[0].items.length, 0);
      assert.equal(target.useSelectedInventoryItem('chest-oxygen'), true);
      target.state.elapsed += 3; target._updateSupplyUses();
      assert.equal(target.player.oxygen, 20); assert.equal(target.backpack.items.length, 1);
      await r.drain();
      assert.equal(remote.player.supplyUse.itemId, 'chest-oxygen');
      r.host.state.elapsed += 2; r.host._updateSupplyUses(); r.snapshot(); await r.drain();
      assert.equal(remote.player.oxygen, 70); assert.equal(target.player.oxygen, 70);
      assert.equal(target.backpack.items.length, 0); assert.equal(remote.backpack.items.length, 0);
      for (const [id, before] of otherOxygen) {
        assert.equal(r.host.remotePlayers.get(id).player.oxygen, before);
        assert.equal(r.games.get(id).game.player.oxygen, before);
      }

      const donorId = count === 2 ? 'host' : r.ids[1], donor = r.games.get(donorId).game;
      const donorBackpack = donorId === 'host' ? r.host.backpack : r.host.remotePlayers.get(donorId).backpack;
      donorBackpack.place(oxygen('teammate-oxygen'));
      if (donorId !== 'host') {
        Object.assign(r.host.remotePlayers.get(donorId).player, { x: 100, y: 100 });
        r.host.remotePlayers.get(donorId).inventoryRevision = 1;
      }
      r.snapshot(); await r.drain();
      donor.state.lootContainerId = 'chest';
      assert.equal(donor.loot.request('deposit', 'teammate-oxygen'), true);
      await r.drain();
      assert.equal(donor.backpack.items.length, 0);
      assert.equal(target.loot.request('take', 'teammate-oxygen'), true);
      await r.drain();
      assert.equal(target.backpack.items[0].id, 'teammate-oxygen');
      assert.equal(target.useSelectedInventoryItem('teammate-oxygen'), true); await r.drain();
      r.host.state.elapsed += 2; r.host._updateSupplyUses(); r.snapshot(); await r.drain();
      assert.equal(target.player.oxygen, 100); assert.equal(target.backpack.items.length, 0);
      for (const [id, before] of otherOxygen) {
        assert.equal(r.host.remotePlayers.get(id).player.oxygen, before);
        assert.equal(r.games.get(id).game.player.oxygen, before);
      }
    } finally { r.close(); }
  });

  test(`${count} LAN players deduplicate container requests and keep recipient inventories separate`, async () => {
    const r = room(count), targetId = r.ids.at(-1), target = r.games.get(targetId).game;
    try {
      for (const entry of r.host.remotePlayers.values()) Object.assign(entry.player, { x: 100, y: 100 });
      r.host.map.containers.push({ id: 'chest', x: 100, y: 100, fixed: true, revision: 0, items: [oxygen('only-oxygen')] });
      r.host.loot.broadcastBox('chest'); await r.drain();
      const request = { missionId: r.host.state.missionFxId, requestId: 1, containerId: 'chest', action: 'take', itemId: 'only-oxygen' };
      target.coopSession.sendEvent('loot-request', request); await r.drain();
      for (const id of r.ids.slice(1)) r.games.get(id).session.sendEvent('loot-request', request);
      await r.drain();
      assert.equal(r.host.loot.revision, 1); assert.equal(r.host.map.containers[0].revision, 1);
      assert.equal(target.backpack.items.length, 1);
      for (const id of r.ids.slice(1).filter(id => id !== targetId)) assert.equal(r.games.get(id).game.backpack.items.length, 0);
      assert.equal([...r.host.remotePlayers.values()].flatMap(entry => entry.backpack.items).length, 1);
      const results = r.frames.filter(frame => JSON.parse(frame.payload).type === 'loot-result');
      assert.ok(results.every(frame => frame.channel === 'events' && frame.targetId));
      assert.equal(results.filter(frame => frame.targetId === targetId).length, 2);
    } finally { r.close(); }
  });

  test(`${count} LAN players route revive input to host, cancel on movement, and restore the intended player`, async () => {
    const r = room(count), rescuer = r.games.get(r.ids.at(-1)).game, remote = r.host.remotePlayers.get(r.ids.at(-1));
    try {
      Object.assign(r.host.player, { x: 100, y: 100, health: 0, oxygen: 0 }); r.host._markDowned(r.host.player);
      Object.assign(remote.player, { x: 120, y: 100 }); r.snapshot(); await r.drain();
      rescuer.coopSession.sendEvent('action', { action: 'interact' }); await r.drain();
      assert.equal(r.host.coopReviveAssignments.get('host'), r.ids.at(-1));
      assert.equal(rescuer._beginCoopRevive(rescuer.player), false);
      r.host._updateCoopRevive(1);
      rescuer.state.keys.d = true; rescuer._sendGuestInput(); await r.drain(); r.host._updateCoopRevive(1);
      assert.equal(r.host.player.reviveProgress, 0); assert.equal(r.host.player.downed, true);
      rescuer.state.keys = {}; rescuer._sendGuestInput();
      rescuer.coopSession.sendEvent('action', { action: 'interact' }); await r.drain();
      rescuer._updateCoopRevive(3); assert.equal(rescuer.remotePlayers.get('host').player.downed, true);
      r.host._updateCoopRevive(3); r.snapshot(); await r.drain();
      assert.equal(r.host.player.downed, false); assert.equal(r.host.player.health, 40); assert.equal(r.host.player.oxygen, 30);
      for (const id of r.ids.slice(1)) {
        const hostView = r.games.get(id).game.remotePlayers.get('host').player;
        assert.equal(hostView.downed, false); assert.equal(hostView.health, 40); assert.equal(hostView.oxygen, 30);
      }
      assert.equal(remote.player.health, 100);
    } finally { r.close(); }
  });

  test(`${count} LAN players restore targeted rejoin inventory, containers, corpses, equipment and neutral input`, async () => {
    const r = room(count), id = r.ids.at(-1), guest = r.games.get(id).game, remote = r.host.remotePlayers.get(id);
    try {
      remote.backpack.place(oxygen('retained-oxygen')); remote.inventoryRevision = 4;
      Object.assign(remote.player, { x: 240, y: 260, health: 40, oxygen: 55 });
      r.host.map.containers.push({ id: 'missed-chest', x: 200, y: 210, fixed: true, revision: 2, items: [oxygen('missed-oxygen')] });
      r.host.loot.revision = 2;
      r.host.loot.transactions.requests.set(id, { latest: 7, results: new Map() });
      r.host.corpseRegistry = [{ id: 'corpse-1', kind: 'hunter', x: 180, y: 210, angle: 0, width: 32 }]; r.host.corpseRevision = 3;
      r.host.equipment.event('barrier-add', { id: 'barrier-1', x: 300, y: 300, w: 64, h: 32, hp: 20 });
      await r.drain();
      guest.state.barriers = []; guest.equipment.revision = 0;
      guest.state.keys = { d: true }; guest.state.fireHeld = true;
      r.host.coopStartPayload = { missionId: r.host.state.missionFxId };
      r.host._setCoopMemberStatus(id, 'offline');
      r.host._setCoopMemberStatus(id, 'connected'); await r.drain();
      assert.equal(guest.player.x, 240); assert.equal(guest.player.y, 260);
      assert.equal(guest.player.health, 40); assert.equal(guest.player.oxygen, 55);
      assert.equal(guest.backpack.items[0].id, 'retained-oxygen');
      assert.equal(guest.map.containers[0].items[0].id, 'missed-oxygen');
      assert.equal(guest.loot.requestSequence, 7); assert.equal(guest.corpseRegistry[0].id, 'corpse-1');
      assert.equal(Object.keys(guest.state.keys).length, 0); assert.equal(guest.state.fireHeld, false);
      assert.equal(remote.input.fire, false); assert.equal(remote.input.keys.d, false);
      assert.equal(guest.state.equipmentSyncing, true);
      r.host.equipment.pumpTransfers(); await r.drain();
      assert.equal(guest.state.barriers[0].id, 'barrier-1'); assert.equal(guest.state.equipmentSyncing, false);
      assert.equal(remote.equipmentSyncing, false);
      const rejoins = r.frames.filter(frame => JSON.parse(frame.payload).type === 'rejoin-state');
      assert.equal(rejoins.length, 1); assert.equal(rejoins[0].targetId, id); assert.equal(rejoins[0].channel, 'events');
    } finally { r.close(); }
  });

  test(`${count} LAN players settle per-player finish and reject a receipt for another identity`, async () => {
    const r = room(count), missionId = r.host.state.missionFxId;
    try {
      const registration = { missionId, reportToken: 'a'.repeat(64), participants: [] };
      const access = {};
      for (const [slot, id] of r.ids.entries()) {
        const token = String(slot + 1).repeat(64), fixture = r.games.get(id);
        access[id] = { missionId, playerId: id, claimToken: token };
        registration.participants.push({ playerId: id, claimToken: token });
        await fixture.game.rewards.rememberAccess(access[id]);
        r.host.defeatLedger.record('hunter', `hunter-${id}`, id);
        if (slot) r.host.defeatLedger.record('heavy', `heavy-${id}`, id);
      }
      r.host.rewardMission = { missionId, access };
      await r.host.rewards.edit(data => { data.missions[missionId] = { registration, hostToken: 'host-token', registered: true }; });
      const claims = [], targetId = r.ids.at(-1); let wrongIdentity = true;
      for (const [id, fixture] of r.games) fixture.game.rewards.request = async (url, method, header, token, body) => {
        if (method === 'PUT') {
          assert.equal(id, 'host'); assert.equal(header, 'x-mission-report-token');
          assert.equal(body.players.length, count); return {};
        }
        claims.push({ id, url, token });
        assert.ok(url.endsWith(`/receipts/${id}`)); assert.equal(token, access[id].claimToken);
        const row = r.host.state.settlement?.rewards.find(row => row.playerId === id);
        if (!row) return { status: 'pending' };
        return { status: 'complete', receipt: { ...row, playerId: wrongIdentity && id === targetId ? 'host' : id,
          missionId, id: `${missionId}.${id}`, expiresAt: Date.now() + 86400000 } };
      };
      r.host.finish(true); await r.drain();
      const target = r.games.get(targetId);
      assert.equal(target.game.state.settlement.rewardStatus, '待结算');
      assert.equal(target.game.state.money, 1000);
      assert.ok(target.game.rewards.read().claims[`${missionId}.${targetId}`]);
      wrongIdentity = false;
      await Promise.all([...r.games.values()].map(fixture => fixture.game.rewards.flush())); await r.drain();
      for (const [id, fixture] of r.games) {
        const row = r.host.state.settlement.rewards.find(row => row.playerId === id), save = JSON.parse(fixture.storage.get('voidshift_save'));
        const heavy = id === 'host' ? 0 : 1, baseReward = 10 + heavy * 100;
        assert.deepEqual(JSON.parse(JSON.stringify(row.counts)), { hunter: 1, monster: 0, heavy });
        assert.equal(row.baseReward, baseReward);
        assert.equal(row.difficultyMultiplier, 2); assert.equal(row.resultMultiplier, 1);
        assert.equal(row.amount, baseReward * 2);
        assert.equal(fixture.game.state.running, false); assert.equal(fixture.game.state.completed, true);
        assert.equal(fixture.game.state.money, 1000 + row.amount); assert.equal(fixture.game.state.settlement.rewardStatus, '已到账');
        assert.equal(save.profileMissions[missionId].outcome, 'success');
        assert.deepEqual(save.profileDefeats[missionId], JSON.parse(JSON.stringify(row.counts)));
        assert.ok(save.appliedRewardReceipts[`${missionId}.${id}`]);
        await fixture.game.rewards.rememberAccess(access[id]);
      }
      const finishFrames = r.frames.filter(frame => JSON.parse(frame.payload).type === 'finish');
      for (const frame of finishFrames) {
        assert.equal(JSON.parse(frame.payload).resultId, `${missionId}:${frame.targetId}`);
        r.host.coopSession.sendEvent('finish', JSON.parse(frame.payload), frame.targetId);
      }
      await r.drain(); await Promise.all([...r.games.values()].map(fixture => fixture.game.rewards.flush()));
      for (const [id, fixture] of r.games) assert.equal(fixture.game.state.money,
        1000 + r.host.state.settlement.rewards.find(row => row.playerId === id).amount);
      assert.ok(claims.some(claim => claim.id === targetId));
    } finally { r.close(); }
  });
}
