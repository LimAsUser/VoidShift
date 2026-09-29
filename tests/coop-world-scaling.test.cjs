const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = { window: { addEventListener() {} }, structuredClone, performance: { now: () => 1000 } };
for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/inventory.js', 'globalThis.BackpackManagerUnderTest = BackpackManager;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/map.js', 'globalThis.MapManagerUnderTest = MapManager;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', file), 'utf8')}\n${exportCode}`, sandbox);
}

const MapManager = sandbox.MapManagerUnderTest;
const BackpackManager = sandbox.BackpackManagerUnderTest;
const Game = sandbox.GameUnderTest;

test('same map seed produces the same structure signature and another seed differs', () => {
  const first = new MapManager();
  const second = new MapManager();
  first.reset('medium', 123456);
  second.reset('medium', 123456);
  const other = new MapManager();
  other.reset('medium', 654321);

  assert.equal(first.layoutSignature(), second.layoutSignature());
  assert.notEqual(first.layoutSignature(), other.layoutSignature());
});

test('host publishes the union of rooms visited by all online players', () => {
  const rooms = [
    { discovered: true, id: 0 },
    { discovered: false, id: 1 },
    { discovered: false, id: 2 }
  ];
  const host = { x: 10, y: 10 };
  const guest = { x: 20, y: 20 };
  const game = Object.create(Game.prototype);
  game.state = {
    elapsed: 1, extractionCalled: false, loot: 0, lootValue: 0,
    finalTerminalPressure: false, inventory: [], remoteInventory: [],
    bulletTraces: [], impactParticles: [], coop: { playerId: 'host' }
  };
  game.player = host;
  game.remotePlayers = new Map([['guest-1', { id: 'guest-1', player: guest, online: true, inventory: [] }]]);
  game.monster = {};
  game.hunters = [];
  game.map = {
    worldRooms: rooms, doors: [], scrap: [], terminals: [],
    getRoomAt(x) { return x === 10 ? rooms[0] : rooms[1]; },
    layoutSignature: () => 'same-layout'
  };
  game._playerSnapshot = player => ({ x: player.x, y: player.y });

  const snapshot = game._createCoopSnapshot();

  assert.deepEqual(snapshot.discoveredRooms, [0, 1]);
  assert.equal(rooms[1].discovered, true);
});

test('co-op difficulty scales only counts with the V18 team factors without mutating the profile', () => {
  const hunterSettings = {
    small: { hunters: 3, hunterRespawnCount: 1, hunterMaxHp: 1, hunterSpawnInterval: 30 },
    medium: { hunters: 6, hunterRespawnCount: 2, hunterMaxHp: 2, hunterSpawnInterval: 30 }
  };
  const finalSettings = { spawnCount: 3, spawnInterval: 30 };
  const game = Object.create(Game.prototype);

  const expected = [
    [2, 3, 1, 1, 30, 3, 30],
    [3, 5, 1, 2, 30, 5, 30],
    [4, 6, 1, 2, 30, 6, 30]
  ];
  for (const [players, hunters, hp, respawns, interval, finalCount, finalInterval] of expected) {
    const scaled = game._scaleCoopMissionSettings(hunterSettings, finalSettings, players, 'small');
    assert.deepEqual({ ...scaled.hunterSettings.small }, {
      hunters, hunterRespawnCount: respawns, hunterMaxHp: hp, hunterSpawnInterval: interval
    });
    assert.deepEqual({ ...scaled.finalTerminalSettings }, { spawnCount: finalCount, spawnInterval: finalInterval });
  }
  assert.deepEqual({ ...hunterSettings.small }, { hunters: 3, hunterRespawnCount: 1, hunterMaxHp: 1, hunterSpawnInterval: 30 });
});

test('runtime co-op settings override the mission only and leave safehouse profiles unchanged', () => {
  const base = { small: { hunters: 3, hunterRespawnCount: 1, hunterMaxHp: 1, hunterSpawnInterval: 30 } };
  const game = Object.create(Game.prototype);
  game.state = {
    hunterSettings: base,
    finalTerminalSettings: { spawnCount: 3, spawnInterval: 30 },
    missionHunterSettings: { small: { hunters: 6, hunterRespawnCount: 2, hunterMaxHp: 2, hunterSpawnInterval: 60 } },
    missionFinalTerminalSettings: { spawnCount: 6, spawnInterval: 60 }
  };

  assert.equal(game._getHunterSettings('small').hunters, 6);
  assert.deepEqual({ ...game._getFinalTerminalSettings() }, { spawnCount: 6, spawnInterval: 60 });
  assert.equal(base.small.hunters, 3);
  assert.equal(game.state.finalTerminalSettings.spawnCount, 3);
});

test('only the host fails a co-op mission after every online player is down', () => {
  const game = Object.create(Game.prototype);
  game.player = { health: 0, oxygen: 0, downed: true };
  game.remotePlayers = new Map();
  game._coopRosterEntries = () => [
    { id: 'host', player: game.player, local: true, online: true },
    ...[...game.remotePlayers.values()].map(entry => ({ ...entry, local: false }))
  ];
  game.state = { coop: { running: true, role: 'guest' } };
  assert.equal(game._shouldFailMission(), false);

  game.state.coop.role = 'host';
  assert.equal(game._shouldFailMission(), true);
  game.remotePlayers.set('guest-1', { id: 'guest-1', player: { downed: false }, online: true });
  assert.equal(game._shouldFailMission(), false);
});

test('the host validates and consumes a guest oxygen bottle exactly once', () => {
  const player = { x: 0, y: 0, oxygen: 35, downed: false, stunned: 0 };
  const backpack = BackpackManager.fromType('field');
  backpack.place({ id: 11, type: 'consumable', effect: 'oxygen-50', shape: '1x2', value: 250 });
  const entry = { id: 'guest-1', player, backpack, inventory: backpack.items, online: true };
  const game = Object.create(Game.prototype);
  game.state = { running: true, elapsed:0, missionFxId:'supply-test', tutorial: null, coop: { role: 'host', running: true, hostPaused: false } };
  game.player = {health:100,oxygen:100};
  game.remotePlayers = new Map([['guest-1', entry]]);
  game._backpackFor = actor => actor === player ? backpack : null;
  game.ui = { showToast() {} };
  game._handleRemoteAction({ action: 'use-supply', itemId: 11,requestId:1,missionId:'supply-test' }, 'guest-1');
  assert.equal(player.oxygen,35);game.state.elapsed=2;game._updateSupplyUses();

  assert.equal(player.oxygen, 85);
  assert.equal(backpack.items.length, 0);
  game._handleRemoteAction({ action: 'use-supply', itemId: 11,requestId:1,missionId:'supply-test' }, 'guest-1');
  assert.equal(player.oxygen, 85);
});
