const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function canvas() {
  const calls = [], stack = [];
  let points = [];
  const keys = ['globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle', 'lineWidth', 'shadowBlur'];
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0,
    save() { stack.push(keys.map(key => this[key])); },
    restore() { const values = stack.pop(); keys.forEach((key, index) => { this[key] = values[index]; }); },
    beginPath() { points = []; }, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
    createPattern() { return 'pattern'; },
    createRadialGradient() { return { addColorStop() {} }; },
    createConicGradient() { return { addColorStop() {} }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  };
  for (const kind of ['setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect', 'strokeRect',
    'fill', 'stroke', 'arc', 'clip', 'fillText', 'drawImage', 'setLineDash', 'closePath', 'rect', 'putImageData']) {
    ctx[kind] = function (...args) { calls.push({ kind, args, points: points.slice(), alpha: this.globalAlpha,
      composite: this.globalCompositeOperation, fill: this.fillStyle, stroke: this.strokeStyle,
      width: this.lineWidth, blur: this.shadowBlur }); };
  }
  return { width: 800, height: 600, clientWidth: 800, clientHeight: 600, style: {}, calls, ctx, getContext: () => ctx };
}

function setup() {
  const buffers = [];
  const sandbox = { Image: class { constructor() { this.complete = true; this.naturalWidth = this.naturalHeight = 512; } },
    window: { matchMedia: () => ({ matches: false }) },
    document: { createElement() { const buffer = canvas(); buffers.push(buffer); return buffer; } } };
  for (const [file, symbol] of [['config', 'Config'], ['inventory', 'BackpackManager'], ['entities', null],
    ['map', 'MapManager'], ['renderer', 'Renderer']]) {
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8')}\n${symbol ? `globalThis.${symbol} = ${symbol};` : ''}`, sandbox);
  }
  const world = canvas(), vision = canvas();
  const renderer = new sandbox.Renderer({ canvas: world, ctx: world.ctx, visionCanvas: vision, visionCtx: vision.ctx });
  const room = { x: 0, y: 0, w: 600, h: 400, lights: [], label: 'TEST', center: { x: 300, y: 200 } };
  const map = Object.assign(Object.create(sandbox.MapManager.prototype), { worldW: 4000, worldH: 2000,
    worldRooms: [room], walls: [], doors: [], terminals: [], scrap: [], windows: [], containers: [] });
  const player = { x: 100, y: 100, angle: 0, flashlight: false, armory: {} };
  const state = { elapsed: 1, cameraZoom: 1, stabilized: false, laserJitter: 0, selectedDifficulty: 'easy',
    bulletTraces: [], impactParticles: [], heavies: [], nightmares: [], corpses: [], damageNumbers: [],
    casings: [], magazines: [], barriers: [], powerLossStartedAt: null };
  const monster = { active: false };
  renderer.prepareCamera(player, state);
  return { renderer, world, vision, buffers, map, player, state, room, monster, sandbox };
}

test('laser retains the wall ray endpoint while drawing a faint red one CSS pixel line without glow', () => {
  const { renderer, map, player, state, world } = setup();
  world.clientWidth = 900; world.clientHeight = 602;
  map.walls = [{ x1: 220, y1: 0, x2: 220, y2: 400 }];
  state.stabilized = true; state.cameraZoom = 2;
  renderer.drawWorldOverlay(player, map, state);
  const line = world.calls.find(call => call.kind === 'stroke' && call.points[0]?.[0] === 100 && call.points[0]?.[1] === 100);
  assert.ok(line);
  assert.equal(line.stroke, 'rgba(255,65,65,.35)');
  assert.equal(line.width, .5);
  assert.equal(line.blur, 0);
  assert.deepEqual(line.points, [[100, 100], [220, 100]]);
});

test('strip light falls off from the whole line segment and overlapping lamps cannot saturate the room', () => {
  const { renderer } = setup();
  assert.equal(typeof renderer.stripLightStrength, 'function', 'renderer must expose the real attenuation used by its cached mask');
  const strip = { x1: 20, y1: 20, x2: 580, y2: 20, range: 600 };
  const near = renderer.stripLightStrength(strip, 300, 20), far = renderer.stripLightStrength(strip, 300, 320);
  assert.ok(near > .65 && near <= .75);
  assert.ok(far < .15 && far > 0);
  assert.equal(renderer.stripLightStrength(strip, 20, 20), near, 'strip endpoints and midpoint are equally bright');
  const room = { x: 0, y: 0, w: 600, h: 400, lights: [strip, { ...strip }] };
  const cached = renderer.roomLightField(room, { elapsed: 0 });
  assert.ok(Math.max(...cached.values) <= .75, 'max blending does not add overlapping lamp alpha');
  const single = renderer.roomLightField({ ...room, lights: [strip] }, { elapsed: 0 });
  assert.deepEqual(Array.from(cached.values), Array.from(single.values));
});

test('normal and fault light fields cache geometry, compose max once, and obey reduced motion and blackout', () => {
  const { renderer, room, state, player, map, vision, buffers } = setup();
  assert.equal(typeof renderer.roomLightField, 'function', 'cached lighting field must be available');
  room.lights = [
    { x1: 20, y1: 20, x2: 580, y2: 20, range: 600, state: 'normal' },
    { x1: 20, y1: 380, x2: 580, y2: 380, range: 600, state: 'flicker', phase: .2 },
    { x1: 20, y1: 200, x2: 580, y2: 200, range: 600, state: 'off' }
  ];
  renderer.motionQuery.matches = true;
  const first = renderer.roomLightField(room, state), normal = first.normal, fault = first.faults[0].values;
  assert.ok(first.values.every((value, index) => Math.abs(value - Math.max(normal[index], fault[index] * .5)) < .000001));
  renderer.drawCenteredVision(player, map, state);
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5).length, 1,
    'one room field is erased rather than stacking normal and fault masks');
  const count = buffers.length;
  renderer.motionQuery.matches = false; state.elapsed = 2;
  const second = renderer.roomLightField(room, state);
  assert.equal(second.normal, normal); assert.equal(second.faults[0].values, fault);
  renderer.drawCenteredVision(player, map, state);
  assert.equal(buffers.length, count);
  state.powerLossStartedAt = 0; state.elapsed = 3; vision.calls.length = 0;
  renderer.drawCenteredVision(player, map, state);
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5).length, 0);
});

test('new room mask remains clipped by the forward view and closed doors', () => {
  const { renderer, room, state, player, map, vision } = setup();
  room.lights = [{ x1: 20, y1: 20, x2: 580, y2: 20, range: 600 }];
  map.doors = [{ p1: { x: 180, y: 0 }, p2: { x: 180, y: 400 }, open: false }];
  renderer.drawCenteredVision(player, map, state);
  const clip = vision.calls.find(call => call.kind === 'clip');
  assert.ok(clip.points.every(([x]) => x >= player.x && x <= 180.001));
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5).length, 1);
});

test('hit flash uses a cached white sprite alpha mask and expires at the supplied time', () => {
  const { renderer, world, map, player, state, monster, buffers } = setup();
  state.nightmares = [{ id: 'n', x: 150, y: 100, angle: 0, active: true, hitFlashUntil: 1.08 }];
  renderer.draw(player, monster, map, state, []);
  const mask = buffers.find(buffer => buffer.calls.some(call => call.kind === 'fillRect' && call.composite === 'source-in' && call.fill === '#fff'));
  assert.ok(mask, 'the white fill must be clipped to the original sprite alpha');
  assert.ok(mask.calls.some(call => call.kind === 'drawImage' && call.args[0].src.endsWith('monster-topdown.png')));
  assert.ok(world.calls.some(call => call.kind === 'drawImage' && call.args[0] === mask));
  const count = buffers.length; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.equal(buffers.length, count);
  state.elapsed = 1.081; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.ok(!world.calls.some(call => call.kind === 'drawImage' && call.args[0] === mask));
});

test('hit masks are shared across matching sprites and hidden hit feedback does not draw', () => {
  const { renderer, world, map, player, state, monster, buffers } = setup();
  state.nightmares = [{ id: 'a', x: 145, y: 100, angle: 0, active: true, hitFlashUntil: 1.08 },
    { id: 'b', x: 160, y: 100, angle: 0, active: true, hitFlashUntil: 1.08 }];
  renderer.draw(player, monster, map, state, []);
  const masks = buffers.filter(buffer => buffer.calls.some(call => call.kind === 'fillRect' && call.composite === 'source-in'));
  assert.equal(masks.length, 1);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0] === masks[0]).length, 2);
  map.walls = [{ x1: 120, y1: 0, x2: 120, y2: 400 }]; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0] === masks[0]).length, 0);
});

test('lethal-hit corpse records retain their timed white sprite mask without revealing hidden corpses', () => {
  const { renderer, world, map, player, state, monster, buffers } = setup();
  state.corpses = [{ id: 'corpse-a', effectKey: 'hunter:0', kind: 'hunter', x: 150, y: 100,
    angle: .4, width: 63, hitFlashUntil: 1.08, fadeRemaining: null }];
  renderer.draw(player, monster, map, state, []);
  const mask = buffers.find(buffer => buffer.calls.some(call => call.kind === 'fillRect' && call.composite === 'source-in'));
  assert.ok(mask, 'lethal hit must keep the white alpha mask when live drawing switches to a corpse record');
  assert.ok(mask.calls.some(call => call.kind === 'drawImage' && call.args[0].src.endsWith('hunter-down.png')));
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0] === mask).length, 1);
  map.walls = [{ x1: 120, y1: 0, x2: 120, y2: 400 }]; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0] === mask).length, 0);
  map.walls = []; state.elapsed = 1.081; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0] === mask).length, 0);
});

test('discovery and damage feedback respect visibility, fade and suppress motion when requested', () => {
  const { renderer, world, map, player, state, monster } = setup();
  state.nightmares = [{ id: 'n', x: 150, y: 100, angle: 0, active: true, discoveryTimer: 1 }];
  state.damageNumbers = [{ key: 'n', x: 150, y: 100, radius: 20, amount: 5, born: 1, shotId: 's' },
    { key: 'hidden', x: 50, y: 400, radius: 20, amount: 7, born: 1 }];
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.filter(call => call.kind === 'fillText' && call.args[0] === '!').length, 1);
  const early = world.calls.find(call => call.kind === 'fillText' && call.args[0] === '5');
  assert.ok(early); assert.ok(!world.calls.some(call => call.kind === 'fillText' && call.args[0] === '7'));
  state.elapsed = 1.6; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  const later = world.calls.find(call => call.kind === 'fillText' && call.args[0] === '5');
  assert.ok(later.args[2] < early.args[2]); assert.ok(later.alpha < early.alpha);
  renderer.motionQuery.matches = true; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.find(call => call.kind === 'fillText' && call.args[0] === '5').args[2], early.args[2]);
  map.walls = [{ x1: 120, y1: 0, x2: 120, y2: 400 }]; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.ok(!world.calls.some(call => call.kind === 'fillText' && ['!', '5'].includes(call.args[0])));
  map.walls = []; state.elapsed = 1.901; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.ok(!world.calls.some(call => call.kind === 'fillText' && call.args[0] === '5'));
});

test('local and remote active shields draw faint bubbles without glow and expire independently', () => {
  const { renderer, world, map, player, state, monster } = setup();
  player.shieldUntil = 2;
  const remote = { x: 155, y: 100, angle: 0, shieldUntil: 1.5 };
  renderer.draw(player, monster, map, state, [], [{ player: remote, slot: 2 }]);
  const bubbles = world.calls.filter(call => call.kind === 'stroke' && call.stroke === 'rgba(101,221,235,.38)');
  assert.equal(bubbles.length, 2); assert.ok(bubbles.every(call => call.blur === 0));
  state.elapsed = 1.6; world.calls.length = 0;
  renderer.draw(player, monster, map, state, [], [{ player: remote, slot: 2 }]);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.stroke === 'rgba(101,221,235,.38)').length, 1);
});

test('barriers use their generated sprite with health and legal or illegal local blueprint colors', () => {
  const { renderer, world, map, player, state, monster } = setup();
  state.barriers = [{ id: 'b', x: 145, y: 90, w: 128, h: 16, hp: 13 }];
  state.barrierBlueprint = { x: 160, y: 110, w: 16, h: 128, hp: 20, vertical: true, valid: true };
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0].src?.endsWith('equipment-v17/barrier.png')).length, 2);
  assert.ok(world.calls.some(call => call.kind === 'fillText' && call.args[0] === '13 / 20'));
  assert.ok(world.calls.some(call => call.kind === 'strokeRect' && call.stroke === '#65ddeb'));
  state.barrierBlueprint.valid = false; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.ok(world.calls.some(call => call.kind === 'strokeRect' && call.stroke === '#ff615f'));
  assert.equal(state.barriers[0].hp, 13, 'rendering does not mutate collision or health state');
});

test('casings hold eight seconds then fade, magazines persist, and debris is culled below actors', () => {
  const { renderer, world, map, player, state, monster } = setup();
  state.casings = [{ id: 'c', x: 150, y: 100, angle: .3, born: 0 }, { id: 'off', x: 10000, y: 10000, born: 0 }];
  state.magazines = [{ id: 'm', x: 160, y: 100, angle: .4, born: 0, weaponId: 'pistol' }];
  state.nightmares = [{ x: 170, y: 100, angle: 0, active: true }];
  for (const [elapsed, alpha] of [[7, 1], [9, .5], [10, null]]) {
    state.elapsed = elapsed; world.calls.length = 0;
    renderer.draw(player, monster, map, state, []);
    const casing = world.calls.find(call => call.kind === 'fillRect' && call.fill === '#bea271');
    if (alpha == null) assert.equal(casing, undefined); else assert.equal(casing?.alpha, alpha);
    assert.equal(world.calls.filter(call => call.kind === 'fillRect' && call.fill === '#bea271').length, alpha == null ? 0 : 1);
    assert.equal(world.calls.filter(call => call.kind === 'fillRect' && call.fill === '#7c8d97').length, 1);
    assert.ok(world.calls.findIndex(call => call.kind === 'fillRect' && call.fill === '#7c8d97') <
      world.calls.findIndex(call => call.kind === 'drawImage' && call.args[0].src?.endsWith('monster-topdown.png')));
  }
  state.elapsed = .15; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  const bounce = world.calls.find(call => call.kind === 'translate' && call.args[0] === 150);
  assert.ok(bounce.args[1] < 100);
  renderer.motionQuery.matches = true; world.calls.length = 0;
  renderer.draw(player, monster, map, state, []);
  assert.equal(world.calls.find(call => call.kind === 'translate' && call.args[0] === 150).args[1], 100);
});

test('world terminals, searchable crates, grenades and collectibles use the new equipment art', () => {
  const { renderer, world, map, player, state, monster } = setup();
  map.terminals = [{ x: 150, y: 100, solved: false }];
  map.containers = [{ x: 170, y: 100, w: 44, h: 32 }];
  map.scrap = [{ x: 200, y: 100, name: '芯片', rarity: 'rare' }, { x: 210, y: 100, effect: 'health-40' }];
  state.flashbangs = [{ x: 220, y: 100, skillId: 'grenade' }];
  renderer.draw(player, monster, map, state, []);
  for (const name of ['terminal', 'crate', 'grenade', 'chip', 'medkit']) {
    assert.ok(world.calls.some(call => call.kind === 'drawImage' && call.args[0].src?.endsWith(`equipment-v17/${name}.png`)), name);
  }
});
