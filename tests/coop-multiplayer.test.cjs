const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = {
  window: { addEventListener() {} },
  crypto: { getRandomValues(array) { array[0] = 123; return array; } },
  EventTarget,
  CustomEvent,
  structuredClone,
  performance: { now: () => 1000 }
};
for (const [file, exportCode] of [
  ['js/network.js', 'globalThis.CoopSessionUnderTest = CoopSession;'],
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(root, file), 'utf8')}\n${exportCode}`, sandbox);
}

const CoopSession = sandbox.CoopSessionUnderTest;
const Game = sandbox.GameUnderTest;
const Config = sandbox.ConfigUnderTest;
const Player = sandbox.PlayerUnderTest;
const testMap = { spawnPoint: { x: 100, y: 100 }, blocked: () => false };
const quietAudio = { context: null, lastStep: 0, playTone() {}, playSound() {} };

function channel() {
  return {
    readyState: 'open',
    bufferedAmount: 0,
    sent: [],
    send(data) { this.sent.push(JSON.parse(data)); }
  };
}

test('host state snapshots fan out independently to all three guest connections', () => {
  const session = new CoopSession();
  session.role = 'host';
  const members = ['guest-1', 'guest-2', 'guest-3'].map(id => ({
    id,
    stateChannel: channel(),
    eventChannel: channel()
  }));
  session.peers = new Map(members.map(member => [member.id, member]));

  const sent = session.sendState('snapshot', { tick: 30 });

  assert.equal(sent, 3);
  assert.deepEqual(members.map(member => member.stateChannel.sent[0].tick), [30, 30, 30]);
  assert.ok(members.every(member => member.stateChannel.sent[0].version === 2));
});

test('host can target one guest with an event without broadcasting to the others', () => {
  const session = new CoopSession();
  session.role = 'host';
  const members = ['guest-1', 'guest-2', 'guest-3'].map(id => ({
    id,
    stateChannel: channel(),
    eventChannel: channel()
  }));
  session.peers = new Map(members.map(member => [member.id, member]));

  assert.equal(session.sendEvent('finish', { success: true }, 'guest-2'), true);
  assert.deepEqual(members.map(member => member.eventChannel.sent.length), [0, 1, 0]);
  assert.equal(members[1].eventChannel.sent[0].success, true);
});

test('host snapshots carry stable IDs and state for all four players', () => {
  const game = Object.create(Game.prototype);
  const players = [
    ['guest-1', { x: 10, y: 0 }],
    ['guest-2', { x: 20, y: 0 }],
    ['guest-3', { x: 30, y: 0 }]
  ];
  game.state = {
    elapsed: 1, extractionCalled: false, loot: 0, lootValue: 0,
    finalTerminalPressure: false, inventory: [], remoteInventory: [],
    bulletTraces: [], impactParticles: [], coop: { playerId: 'host' }
  };
  game.player = { x: 0, y: 0 };
  game.remotePlayers = new Map(players.map(([id, player]) => [id, { id, player, online: true, inventory: [] }]));
  game.monster = {};
  game.hunters = [];
  game.map = { doors: [], scrap: [], terminals: [] };
  game._playerSnapshot = player => ({ x: player.x, y: player.y });

  const snapshot = game._createCoopSnapshot();

  assert.equal(JSON.stringify(snapshot.players.map(entry => entry.id)), JSON.stringify(['host', 'guest-1', 'guest-2', 'guest-3']));
  assert.equal(JSON.stringify(snapshot.players.map(entry => entry.state.x)), JSON.stringify([0, 10, 20, 30]));
});

test('guest applies authoritative snapshots for the local player and every remote teammate', () => {
  const game = Object.create(Game.prototype);
  const armory = Player.createDefaultArmory();
  const makeSnapshotState = (x, y) => ({ x, y, angle: 0, health: 100, oxygen: 100, stamina: 100, noise: 0, armory });
  game.state = { coop: { role: 'guest', running: true, playerId: 'guest-2' }, inventory: [], remoteInventory: [] };
  game.player = new Player();
  game.player.reset(testMap, armory);
  game.remotePlayers = new Map(['host', 'guest-1', 'guest-3'].map((id, index) => {
    const player = new Player();
    player.reset(testMap, armory);
    return [id, { id, player, online: true, inventory: [], backpack: { items: [], nextId: 1 } }];
  }));
  game.remoteBackpack = { items: [], nextId: 1 };
  game.monster = {};
  game.hunters = [];
  game.nextHunterSpawnIndex = 0;
  game.map = { doors: [], scrap: [], terminals: [] };
  game.ui = { updateTerminalsStatus() {} };
  game._applyCoopInventorySnapshot = () => false;
  game._lastSnapshotTick = -1;
  const players = [
    { id: 'host', slot: 1, online: true, state: makeSnapshotState(10, 10), inventory: [] },
    { id: 'guest-1', slot: 2, online: true, state: makeSnapshotState(20, 20), inventory: [] },
    { id: 'guest-2', slot: 3, online: true, state: makeSnapshotState(30, 30), inventory: [] },
    { id: 'guest-3', slot: 4, online: true, state: makeSnapshotState(40, 40), inventory: [] }
  ];

  game._applyCoopSnapshot({
    players, inventories: {}, monster: { active: false }, hunters: [], doors: [], scrap: [], terminals: [],
    bulletTraces: [], impactParticles: []
  });

  assert.equal(game.player.x, 30);
  assert.equal(JSON.stringify([...game.remotePlayers].map(([id, entry]) => [id, entry.player.x])),
    JSON.stringify([['host', 10], ['guest-1', 20], ['guest-3', 40]]));
});

test('local prediction blends small snapshot drift and snaps back after a large correction', () => {
  const game = Object.create(Game.prototype);
  const player = { x: 0, y: 0 };
  game._applyPlayerSnapshot(player, { x: 10, y: 0 }, 0.35);
  assert.equal(player.x, 3.5);
  game._applyPlayerSnapshot(player, { x: 100, y: 0 }, 0.35);
  assert.equal(player.x, 100);
});

test('host can start with three ready guests and sends all four player identities', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = {
    coop: {
      role: 'host', connected: true, running: false, localReady: true, friendlyFire: true,
      members: [1, 2, 3].map(slot => ({ id: `guest-${slot}`, slot: slot + 1, connected: true, ready: true, armory: { slot } }))
    },
    selectedDifficulty: 'medium', hunterSettings: {}, finalTerminalSettings: {}
  };
  game.player = { exportArmory: () => ({ owned: 'host' }) };
  game.coopSession = { sendEvent: (...args) => sent.push(args) };
  game._beginCoopMission = payload => { game.startedPayload = payload; };

  game.startCoopMission();

  assert.equal(sent[0][0], 'start');
  assert.equal(game.startedPayload.players.length, 4);
  assert.equal(JSON.stringify(game.startedPayload.players.map(player => player.id)), JSON.stringify(['host', 'guest-1', 'guest-2', 'guest-3']));
  assert.equal(game.startedPayload.players[3].armory.slot, 3);
});

test('host simulates movement input independently for all three guest players', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', running: true } };
  game.map = testMap;
  game.audio = quietAudio;
  game.player = new Player();
  game.player.reset(testMap);
  game.player.x = 100;
  game.player.y = 100;
  game.remotePlayers = new Map();
  for (let slot = 2; slot <= 4; slot++) {
    const player = new Player();
    player.reset(testMap);
    player.x = 100;
    player.y = 100 + slot * 30;
    game.remotePlayers.set(`guest-${slot - 1}`, {
      id: `guest-${slot - 1}`, slot, player, online: true, qte: null,
      input: { keys: { d: true }, aim: 0, activeSlot: 'sidearm', flashlight: true, fire: false, seq: 1 }
    });
  }

  game._updateRemotePlayers(0.05);

  assert.equal([...game.remotePlayers.values()].filter(entry => entry.player.x > 100).length, 3);
});

test('enemy threat selection considers all online players and ignores offline players', () => {
  const game = Object.create(Game.prototype);
  const host = { x: 0, y: 0, downed: false };
  const remotePlayers = new Map([
    ['guest-1', { id: 'guest-1', player: { x: 100, y: 0, downed: false }, online: true }],
    ['guest-2', { id: 'guest-2', player: { x: 20, y: 0, downed: false }, online: true }],
    ['guest-3', { id: 'guest-3', player: { x: 1, y: 0, downed: false }, online: false }]
  ]);
  game.player = host;
  game.remotePlayers = remotePlayers;
  game.state = { coop: { playerId: 'host', running: true, role: 'host' }, inventory: [] };
  game.state.remoteInventory = [];

  assert.equal(game._getThreatTarget({ x: 18, y: 0 }), remotePlayers.get('guest-2').player);
});
