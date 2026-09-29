const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = {};
for (const [file, exports] of [
  ['config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['entities.js', 'globalThis.HeavyUnderTest = Heavy; globalThis.FlashbangUnderTest = Flashbang; globalThis.PlayerUnderTest = Player; globalThis.MonsterUnderTest = Monster; globalThis.HunterUnderTest = Hunter;'],
  ['map.js', 'globalThis.MapManagerUnderTest = MapManager;']
]) vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8')}\n${exports}`, sandbox);
const { HeavyUnderTest: Heavy, FlashbangUnderTest: Flashbang } = sandbox;
const map = { blocked: () => false, worldRooms: [], getRoomAt: () => null, monsterSpawns: [{ x: 100, y: 100 }] };

test('heavy charges only through body-width clearance, hits once, and becomes vulnerable while stunned', () => {
  const heavy = new Heavy(3);
  heavy.activate(100, 100);
  const player = { x: 240, y: 100, radius: 12 };
  const narrow = { ...map, blocked: (x, y, radius) => radius > 0 && y < 125 && x > 160 && x < 180 };
  heavy.update(0.1, player, narrow, [player]);
  assert.equal(heavy.phase, 'pursuit');
  heavy.x = 100; heavy.y = 100;
  heavy.update(0.1, player, map, [player]);
  assert.equal(heavy.phase, 'windup');
  heavy.update(2, player, map, [player]);
  assert.equal(heavy.phase, 'charge');
  const hits = heavy.update(1, player, { ...map, blocked: x => x >= 290 }, [player]);
  assert.equal(hits.hits.length, 1);
  assert.equal(heavy.phase, 'stunned');
  assert.equal(heavy.registerHit().hp, 2);
  heavy.stun(5);
  assert.equal(heavy.stunTimer, 5);
  heavy.registerHit(2);
  assert.equal(heavy.dead, true);
});

test('heavy will not wind up when a wall blocks sight to a nearby player center', () => {
  const heavy = new Heavy();
  heavy.activate(0, 0);
  const target = { x: 100, y: 0, radius: 10 };
  const behindWall = { ...map, blocked: (x, _y, radius) => x + radius >= 95 && x - radius <= 96 };
  heavy.update(0.05, target, behindWall, [target]);
  assert.equal(heavy.phase, 'pursuit');
});

test('flashbang travels a clamped distance, fuses, then explodes exactly once', () => {
  const grenade = new Flashbang(1, 'p1', 0, 100, 1, 100);
  assert.equal(grenade.remainingDistance, 50);
  assert.equal(grenade.update(1, map), false);
  assert.equal(grenade.landed, true);
  assert.equal(grenade.update(1, map), true);
  assert.equal(grenade.update(1, map), false);
});

test('flashbang reflects from a closed door and enemies cannot contact while flash stunned', () => {
  const wallMap = { ...map, doors: [{ p1: { x: 40, y: 0 }, p2: { x: 40, y: 200 }, open: false }], walls: [], blocked: x => x >= 37 && x <= 43 };
  const grenade = new Flashbang(2, 'p1', 0, 100, 100, 100);
  grenade.update(1, wallMap);
  assert.ok(grenade.x < 30);
  const player = new sandbox.PlayerUnderTest();
  player.applyFlashStun(5);
  assert.equal(player.shoot().reason, 'stunned');
  const monster = new sandbox.MonsterUnderTest();
  monster.active = true;
  monster.applyFlashStun(5);
  assert.equal(monster.update(1, player, 0, map, null, []).playerHit, false);
  const hunter = new sandbox.HunterUnderTest();
  hunter.active = true;
  hunter.applyFlashStun(5);
  assert.equal(hunter.update(1, player, 0, map, null, []).playerHit, false);
});

test('heavy ignores a downed target', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  heavy.update(1, { x: 200, y: 100, downed: true }, map, []);
  assert.equal(heavy.phase, 'pursuit');
  assert.equal(heavy.x, 100);
});

test('heavy hits the same player id only once per charge across snapshot objects', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  heavy.phase = 'charge';
  heavy.chargeAngle = 0;
  const first = { id: 'guest', x: 130, y: 100, radius: 10 };
  const second = { id: 'guest', x: 160, y: 100, radius: 10 };
  assert.equal(heavy.update(0.2, first, map, [first]).hits.length, 1);
  assert.equal(heavy.update(0.2, second, map, [second]).hits.length, 0);
});

test('heavy walks to a closed door approach before waiting for the doorway', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  const door = { open: false, targetOpen: false };
  heavy.waypoints = [{ x: 125, y: 100, isDoorApproach: true, door }];
  heavy.waypointTimer = 1;
  const blockedMap = { ...map, blocked: x => x >= 140 };
  heavy.update(0.1, { x: 200, y: 100 }, blockedMap, []);
  assert.ok(heavy.x > 100);
});

test('heavy routes around a same-room obstacle instead of pushing into it', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  const room = { x: 0, y: 0, w: 400, h: 300, center: { x: 200, y: 150 }, doors: [] };
  const obstacleMap = { ...map, worldRooms: [room], getRoomAt: () => room,
    blocked: (x, y, radius) => x > 140 - radius && x < 200 + radius && y > 80 - radius && y < 120 + radius };
  const target = { x: 260, y: 100 };
  for (let i = 0; i < 50; i++) heavy.update(0.1, target, obstacleMap, []);
  assert.ok(heavy.x > 175, `x=${heavy.x}, y=${heavy.y}, phase=${heavy.phase}`);
});

test('flash stun cancels a player roll and its invulnerability', () => {
  const player = new sandbox.PlayerUnderTest();
  player.dodgeTimer = 0.4;
  player.invulnerableThisFrame = true;
  player.applyFlashStun(5);
  assert.equal(player.dodgeTimer, 0);
  assert.equal(player.invulnerableThisFrame, false);
});

test('flashbang bounces from the endpoint of a wall using the endpoint normal', () => {
  const wall = { x1: 40, y1: 100, x2: 40, y2: 200 };
  const endpointMap = { walls: [wall], doors: [], blocked: (x, y, radius) => {
    const py = Math.max(100, Math.min(200, y));
    return Math.hypot(x - 40, y - py) < radius;
  } };
  const grenade = new Flashbang(3, 'p1', 0, 80, 100, 130);
  grenade.update(0.15, endpointMap);
  assert.ok(Math.sin(grenade.angle) < 0, `angle=${grenade.angle}`);
});

test('flashbang reflects obliquely from real wall and closed-door collision bands', () => {
  for (const kind of ['wall', 'door']) {
    const map = Object.create(sandbox.MapManagerUnderTest.prototype);
    const segment = { x1: 140, y1: 90, x2: 140, y2: 210 };
    map.walls = kind === 'wall' ? [segment] : [];
    map.doors = kind === 'door' ? [{ p1: { x: 140, y: 90 }, p2: { x: 140, y: 210 }, open: false }] : [];
    const grenade = new Flashbang(kind, 'p1', 100, 100, 200, 150);
    grenade.update(0.09, map);
    assert.ok(Math.cos(grenade.angle) < 0, `${kind} normal component`);
    assert.ok(Math.sin(grenade.angle) > 0, `${kind} tangential component`);
  }
});
