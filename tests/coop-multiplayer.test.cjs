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
  AbortController,
  DOMException,
  RTCPeerConnection: class {
    constructor() { this.connectionState = 'new'; this.iceGatheringState = 'complete'; this.localDescription = null; }
    addEventListener() {}
    createDataChannel(label) { return { label, readyState: 'connecting', addEventListener() {}, close() {} }; }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async close() {}
  },
  fetch: async () => ({ ok: true }),
  structuredClone,
  setTimeout: () => 1,
  clearTimeout() {},
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

test('host binds both created RTC channels before waiting for channel readiness', async () => {
  const session = new CoopSession();
  session.roomCode = 'ABC234';
  session.hostToken = 'host-token';
  const preparing = session._createHostPeer({ id: 'guest-2', slot: 2, generation: 0 });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const peer = session.peers.get('guest-2');

  assert.equal(peer.stateChannel.label, 'state:guest-2');
  assert.equal(peer.eventChannel.label, 'events:guest-2');
  await session.close(false);
  await preparing;
});
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
  assert.ok(members.every(member => member.stateChannel.sent[0].version === 15));
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

test('new ready acknowledgment messages use the bumped lobby protocol version', () => {
  const session = new CoopSession();
  session.role = 'guest';
  const host = { eventChannel: channel() };
  session.peers = new Map([['host', host]]);

  session.sendEvent('request-roster', { slot: 2 });

  assert.equal(host.eventChannel.sent[0].version, 15);
});

test('state snapshots are dropped before stale data can build a large WebRTC queue', () => {
  const session = new CoopSession();
  session.role = 'host';
  const buffered = channel();
  buffered.bufferedAmount = 80_000;
  session.peers = new Map([['guest-1', { id: 'guest-1', stateChannel: buffered }]]);

  assert.equal(session.sendState('snapshot', { tick: 60 }), 0);
  assert.equal(buffered.sent.length, 0);
});

test('joining an older room explains that both players must refresh and recreate it', async () => {
  const originalFetch = sandbox.fetch;
  sandbox.fetch = async () => ({ ok: true, json: async () => ({ protocol_version: 4 }) });
  const session = new CoopSession();

  await assert.rejects(session.join('ABC234'), /刷新页面并重建房间/);
  sandbox.fetch = originalFetch;
});

test('host relays one accepted shot effect to every connected guest except its shooter', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', running: true, playerId: 'host' } };
  game.map = { getRoomAt: () => null, worldRooms: [] };
  game.player = { x: 5, y: 6, angle: 0.2, weaponId: 'pistol' };
  game.remotePlayers = new Map(['guest-1', 'guest-2', 'guest-3'].map((id, index) => {
    const player = { x: index * 100, y: index * 50, angle: index, weaponId: 'smg' };
    return [id, { id, player, online: true }];
  }));
  game.coopSession = { sendEvent: (type, payload, target) => sent.push({ type, payload, target }) };

  game._broadcastWeaponFired(game.remotePlayers.get('guest-2').player, 'shot-22');
  game._broadcastWeaponFired(game.remotePlayers.get('guest-2').player, 'shot-22');

  assert.deepEqual(sent.map(event => event.target), ['guest-1', 'guest-3', 'guest-1', 'guest-3']);
  assert.ok(sent.every(event => event.type === 'weapon-fired'));
  assert.equal(new Set(sent.map(event => event.payload.shotId)).size, 2);
  assert.ok(sent.every(event => event.payload.shotId !== 'shot-22'));
  assert.equal(sent[0].payload.x, 100);
  assert.equal(sent[0].payload.weaponId, 'smg');
});

test('guest plays a remote weapon effect once and ignores an echoed local shot', () => {
  const played = [];
  const game = Object.create(Game.prototype);
  game.state = {
    coop: { role: 'guest', running: true, playerId: 'guest-2' },
    muzzleFlashes: []
  };
  game.player = { x: 0, y: 0, angle: 0 };
  game.audio = { playSpatialSound: (...args) => played.push(args) };
  const room = { id: 'room-a' };
  game.map = { worldRooms: [room], getRoomAt: () => room };
  game.seenWeaponEffects = new Set();
  const remote = { shotId: 'shot-1', shooterId: 'guest-1', x: 120, y: 80, angle: 1, weaponId: 'pistol' };

  assert.equal(game._receiveWeaponFired(remote), true);
  assert.equal(game._receiveWeaponFired(remote), false);
  assert.equal(game._receiveWeaponFired({ ...remote, shotId: 'shot-local', shooterId: 'guest-2' }), false);
  assert.equal(played.length, 1);
  assert.equal(game.state.muzzleFlashes.length, 1);
  assert.equal(game.state.muzzleFlashes[0].roomIndex, 0);
});

test('guest firing plays locally, sends the authoritative shot intent and mirrors auto-reload', () => {
  const sent = [];
  const sounds = [];
  const game = Object.create(Game.prototype);
  game.state = {
    running: true, tutorial: null, stabilized: true, muzzleFlashes: [],
    coop: { role: 'guest', running: true, playerId: 'guest-1', hostPaused: false }
  };
  game.player = {
    x: 40, y: 50, angle: 0, dodgeTimer: 0, stunned: 0, downed: false,
    ammo: 1, reserveAmmo: 24, weaponId: 'pistol',
    shoot(_aim, _map, audio) { this.ammo--; audio.playSound('gunshot', 0.3); return { fired: true }; },
    reload() { return true; }
  };
  game.audio = { playSound: (...args) => sounds.push(args) };
  game.map = { getRoomAt: () => null, worldRooms: [] };
  game.monster = {};
  game.remotePlayers = new Map();
  game.coopSession = { sendEvent: (...args) => { sent.push(args); return true; } };
  game.ui = { updateWeaponReadout() {}, showToast() {} };
  game._tutorialAction = () => {};
  game._createWeaponShotId = () => 'guest-1:1';

  game.shoot(game.player);

  assert.equal(sounds.length, 1);
  assert.equal(sent[0][1].action, 'shoot');
  assert.equal(sent[0][1].shotId, 'guest-1:1');
  assert.equal(sent[0][1].aiming, true);
  assert.equal(sent[1][1].action, 'reload');
});

test('host applies a guest one-shot aiming flag before authoritative spread is calculated', () => {
  let aimedShot = null;
  const game = Object.create(Game.prototype);
  const shooter = {
    x: 100, y: 100, angle: 0, dodgeTimer: 0, stunned: 0, downed: false,
    shoot(aiming) { aimedShot = aiming; return { fired: false, reason: 'cooldown' }; }
  };
  const entry = { id: 'guest-1', player: shooter, online: true, input: { keys: {}, aiming: false } };
  game.state = { running: true, tutorial: null, coop: { role: 'host', running: true, hostPaused: false } };
  game.player = { x: 0, y: 0 };
  game.remotePlayers = new Map([['guest-1', entry]]);
  game.audio = { playTone() {} };
  game.ui = { showToast() {} };

  game._handleRemoteAction({ action: 'shoot', aim: 0.75, aiming: true, shotId: 'guest-1:4' }, 'guest-1');

  assert.equal(entry.input.aiming, true);
  assert.equal(shooter.angle, 0.75);
  assert.equal(aimedShot, true);
});

test('host moves remote players at aimed speed', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', running: true, playerId: 'host' } };
  game.map = testMap;
  game.audio = quietAudio;
  game.player = new Player();
  game.player.reset(testMap);
  game.player.x = 100;
  game.player.y = 100;
  const aimed = new Player();
  aimed.reset(testMap);
  aimed.x = 100;
  aimed.y = 140;
  const entry = {
    id: 'guest-1', player: aimed, online: true, qte: null, lastInputAt: 1000,
    input: { keys: { d: true }, aim: 0, aiming: true, activeSlot: 'sidearm', flashlight: true, fire: false, seq: 1 }
  };
  game.remotePlayers = new Map([['guest-1', entry]]);

  game._updateRemotePlayers(0.05);

  assert.ok(Math.abs(aimed.x - 101.925) < 0.001);
});

test('host uses the continuous remote aiming state when processing automatic fire', () => {
  let aimedShot = null;
  const game = Object.create(Game.prototype);
  const shooter = {
    x: 100, y: 100, angle: 0, activeSlot: 'sidearm',
    weapon: { automatic: true }, ammo: 4, reloading: 0,
    update() {}
  };
  game.state = { coop: { role: 'host', running: true, playerId: 'host' } };
  game.remotePlayers = new Map([['guest-1', {
    id: 'guest-1', player: shooter, online: true, qte: null, lastInputAt: 1000,
    input: { keys: {}, aim: 0, aiming: true, activeSlot: 'sidearm', flashlight: true, fire: true, seq: 1 }
  }]]);
  game._onlineCoopPlayers = () => [];
  game._syncLegacyRemoteAliases = () => {};
  game.shoot = player => { aimedShot = game._isPlayerAiming(player); };

  game._updateRemotePlayers(0.05);

  assert.equal(aimedShot, true);
});

test('guest includes its current aiming state in continuous input updates', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = {
    running: true, elapsed: 0, stabilized: true, keys: {}, fireHeld: false,
    coop: { role: 'guest', running: true, playerId: 'guest-1', connected: true, inputSeq: 0 }
  };
  game.player = {
    downed: false, angle: 0.45, activeSlot: 'sidearm', flashlight: true,
    weapon: { automatic: false }, oxygen: 100, health: 100, stamina: 100, noise: 0, reloading: 0,
    update() {}
  };
  game._onlineCoopPlayers = () => [];
  game._lockFinalTerminalNoise = () => {};
  game._checkCoopDisconnect = () => {};
  game._coopSendTimer = 0;
  game.coopSession = { sendState: (...args) => sent.push(args) };
  game.audio = { update() {} };
  game.ui = { update() {} };

  game._updateGuestCoop(0.05);

  assert.equal(sent[0][0], 'input');
  assert.equal(sent[0][1].aim, 0.45);
  assert.equal(sent[0][1].aiming, true);
});

test('mouse aim exactly inverts the zoomed camera including look and recoil offsets', () => {
  const game = Object.create(Game.prototype);
  const scaleX = 2;
  const scaleY = 2;
  const rect = {
    left: 100, top: 50,
    width: Config.VIEW_W * scaleX,
    height: Config.VIEW_H * scaleY
  };
  game.ui = { frame: { getBoundingClientRect: () => rect } };
  game.player = { x: 200, y: 300, angle: 0 };
  game.state = { stabilized: true, cameraZoom: 1.716, cameraLookX: 55, cameraLookY: -28.6, recoilX: 12, recoilY: -7 };
  game.renderer = { prepareCamera() {} };
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  game.handleAim({ clientX: centerX + scaleX * 250, clientY: centerY - scaleY * 130 });

  assert.ok(Math.abs(game.state.mouseX - (200 + 55 + 12 + 250 / 1.716)) < 0.001);
  assert.ok(Math.abs(game.state.mouseY - (300 - 28.6 - 7 - 130 / 1.716)) < 0.001);
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
  game.map = {
    doors: [], scrap: [], terminals: [], layoutSignature: () => 'shared-layout',
    worldRooms: [{ discovered: false }, { discovered: false }]
  };
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
  game.map = {
    doors: [], scrap: [], terminals: [], layoutSignature: () => 'shared-layout',
    worldRooms: [{ discovered: false }, { discovered: false }]
  };
  game.ui = { updateTerminalsStatus() {}, updateExtractionProgress(state) { game.guestRescueEta = state.rescueRemaining; } };
  game._applyCoopInventorySnapshot = () => false;
  game._lastSnapshotTick = -1;
  const players = [
    { id: 'host', slot: 1, online: true, state: makeSnapshotState(10, 10), inventory: [] },
    { id: 'guest-1', slot: 2, online: true, state: makeSnapshotState(20, 20), inventory: [] },
    { id: 'guest-2', slot: 3, online: true, state: makeSnapshotState(30, 30), inventory: [] },
    { id: 'guest-3', slot: 4, online: true, state: makeSnapshotState(40, 40), inventory: [] }
  ];

  game._applyCoopSnapshot({
    tick: 10000,
    mapSignature: 'shared-layout', discoveredRooms: [0, 1],
    players, inventories: {}, monster: { active: false }, hunters: [], doors: [], scrap: [], terminals: [],
    mission: { elapsed: 10, extractionCalled: true, rescueRemaining: 18, rescueArrived: false,
      rescuePresent: 1, rescueRequired: 4, finalTerminalPressure: false },
    bulletTraces: [], impactParticles: []
  });

  assert.equal(game.player.x, 30);
  assert.equal(game.guestRescueEta, 18);
  assert.deepEqual(game.map.worldRooms.map(room => room.discovered), [true, true]);
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
      members: [1, 2, 3].map(slot => ({ id: `guest-${slot}`, slot: slot + 1, connected: true, ready: true, armory: { slot }, backpackItems: [{ id: `carry-${slot}`, value: 250 }] }))
    },
    selectedDifficulty: 'medium', hunterSettings: {}, finalTerminalSettings: {}, inventory: [{ id: 'host-canister', value: 250 }]
  };
  game.player = { exportArmory: () => ({ owned: 'host' }) };
  game.coopSession = { sendEvent: (...args) => sent.push(args) };
  game._beginCoopMission = payload => { game.startedPayload = payload; };

  game.startCoopMission();

  assert.equal(sent[0][0], 'start');
  assert.equal(game.startedPayload.players.length, 4);
  assert.equal(JSON.stringify(game.startedPayload.players.map(player => player.id)), JSON.stringify(['host', 'guest-1', 'guest-2', 'guest-3']));
  assert.equal(game.startedPayload.players[3].armory.slot, 3);
  assert.equal(game.startedPayload.players[0].backpackItems[0].id, 'host-canister');
  assert.equal(game.startedPayload.players[1].backpackItems[0].id, 'carry-1');
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
      id: `guest-${slot - 1}`, slot, player, online: true, qte: null, lastInputAt: 1000,
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
