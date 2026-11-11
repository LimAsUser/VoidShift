const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function canvas() {
  const calls = [];
  const stack = [];
  let points = [];
  const ctx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    save() { stack.push([this.globalAlpha, this.globalCompositeOperation, this.fillStyle, this.strokeStyle, this.lineWidth]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation, this.fillStyle, this.strokeStyle, this.lineWidth] = stack.pop(); },
    beginPath() { points = []; },
    moveTo(x, y) { points.push([x, y]); },
    lineTo(x, y) { points.push([x, y]); },
    closePath() {},
    createRadialGradient(...args) { return gradient('radial', args); },
    createConicGradient(...args) { return gradient('conic', args); }
  };
  function gradient(kind, args) {
    const result = { kind, args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
    calls.push({ kind: 'gradient', gradient: result });
    return result;
  }
  for (const kind of ['setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect', 'strokeRect',
    'fill', 'stroke', 'arc', 'clip', 'fillText', 'drawImage', 'setLineDash']) {
    ctx[kind] = function (...args) {
      if (kind === 'drawImage' && typeof args[0]?.getContext === 'function' &&
          (!(args[0].width > 0) || !(args[0].height > 0))) {
        throw new Error('InvalidStateError: source canvas has zero width or height');
      }
      calls.push({ kind, args, points: points.slice(), alpha: this.globalAlpha,
        composite: this.globalCompositeOperation, fill: this.fillStyle, stroke: this.strokeStyle, width: this.lineWidth });
    };
  }
  return { width: 800, height: 600, clientWidth: 800, clientHeight: 600, style: {}, calls, ctx, getContext: () => ctx };
}

function setup() {
  const buffers = [];
  const sandbox = {
    Config: { VIEW_W: 800, VIEW_H: 600, WORLD_W: 800, WORLD_H: 600,
      camera: { baseZoom: 1.3, aimMultiplier: 1.1 }, player: { flashlightRange: 420, flashlightSpread: 0.6,
        poweredRoomVisionRange: Math.hypot(900, 602) / 1.56 } },
    Image: class { constructor() { this.complete = true; this.naturalWidth = 200; this.naturalHeight = 100; } },
    document: { createElement(tag) { assert.equal(tag, 'canvas'); const buffer = canvas(); buffers.push(buffer); return buffer; } }
  };
  for (const name of ['map', 'renderer']) {
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')}\nglobalThis.${name === 'map' ? 'MapManager' : 'Renderer'}UnderTest = ${name === 'map' ? 'MapManager' : 'Renderer'};`, sandbox);
  }
  const world = canvas(), vision = canvas();
  const renderer = new sandbox.RendererUnderTest({ canvas: world, ctx: world.ctx, visionCanvas: vision, visionCtx: vision.ctx });
  const map = Object.assign(Object.create(sandbox.MapManagerUnderTest.prototype), {
    worldW: 800, worldH: 600, worldRooms: [], walls: [], doors: [], terminals: [], scrap: []
  });
  const player = { x: 100, y: 100, angle: 0, flashlight: false };
  const state = { cameraZoom: 1.3, cameraLookX: 0, cameraLookY: 0, selectedDifficulty: 'normal', bulletTraces: [], impactParticles: [] };
  const monster = { x: 200, y: 200, angle: 0.4, active: false, recoverTimer: 0 };
  return { renderer, world, vision, buffers, map, player, state, monster };
}

test('hidden startup skips perception drawing for zero bitmap or display dimensions', () => {
  for (const dimensions of [[0,0,0,0], [0,600,800,600], [800,0,800,600], [800,600,0,600], [800,600,800,0]]) {
    const { renderer, vision, buffers, map, player, state } = setup();
    [vision.width, vision.height, vision.clientWidth, vision.clientHeight] = dimensions;
    assert.doesNotThrow(() => renderer.drawCenteredVision(player, map, state));
    assert.equal(buffers.length, 0, 'hidden initialization must not allocate or draw a zero-sized source');
    assert.equal(vision.calls.length, 0);
  }
});

test('perception resumes after hidden startup and survives hide/show with a new viewport size', () => {
  const { renderer, vision, buffers, map, player, state } = setup();
  Object.assign(vision, { width: 0, height: 0, clientWidth: 0, clientHeight: 0 });
  assert.doesNotThrow(() => renderer.drawCenteredVision(player, map, state));
  Object.assign(vision, { width: 800, height: 600, clientWidth: 800, clientHeight: 600 });
  renderer.drawCenteredVision(player, map, state);
  const buffer = renderer.perceptionCanvas;
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage').length, 1);
  Object.assign(vision, { width: 0, height: 0, clientWidth: 0, clientHeight: 0 });
  assert.doesNotThrow(() => renderer.drawCenteredVision(player, map, state));
  assert.equal(buffer.width, 800);
  Object.assign(vision, { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720 });
  assert.doesNotThrow(() => renderer.drawCenteredVision(player, map, state));
  assert.equal(renderer.perceptionCanvas, buffer);
  assert.equal(buffers.length, 1);
  assert.equal(buffer.width, 1280);
  assert.equal(buffer.height, 720);
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage').length, 2);
});

test('camera keeps local look without aiming and honors the supplied zoom', () => {
  const { renderer, player, state } = setup();
  Object.assign(state, { cameraZoom: 1.37, stabilized: false, cameraLookX: 40, cameraLookY: -25, recoilX: 3, recoilY: -2 });
  renderer.prepareCamera(player, state);
  assert.equal(state.cameraZoom, 1.37);
  assert.equal(renderer.cameraOffsetX, 257);
  assert.equal(renderer.cameraOffsetY, 227);
  delete state.cameraZoom;
  renderer.prepareCamera(player, state);
  assert.equal(state.cameraZoom, 1.3);
  delete state.cameraZoom;
  state.stabilized = true;
  renderer.prepareCamera(player, state);
  assert.ok(Math.abs(state.cameraZoom - 1.43) < 1e-10);
});

test('hard difficulty hides both Heavy lane phases while other difficulties retain them', () => {
  const { renderer, world, map, player, state, monster } = setup();
  state.heavy = { x: 300, y: 200, angle: 0, chargeAngle: 0, radius: 44, active: true, dead: false };
  for (const phase of ['windup', 'charge']) {
    state.heavy.phase = phase;
    for (const difficulty of ['easy', 'normal', 'hard']) {
      state.selectedDifficulty = difficulty;
      world.calls.length = 0;
      renderer.draw(player, monster, map, state, []);
      assert.equal(world.calls.some(call => call.kind === 'stroke' && call.width === 88), difficulty !== 'hard');
      assert.ok(world.calls.some(call => call.kind === 'drawImage' && call.args[0].src.endsWith('heavy-topdown.png')));
    }
  }
});

test('living Hunter and stunned Heavy have red circles, while sleeping Monster retains only its status', () => {
  const { renderer, world, map, player, state, monster } = setup();
  state.selectedDifficulty = 'easy';
  Object.assign(monster, { active: true, recoverTimer: 4 });
  state.heavy = { x: 300, y: 200, angle: 0, active: true, phase: 'stunned', stunTimer: 1 };
  renderer.draw(player, monster, map, state, [{ x: 250, y: 250, angle: 0, active: true }]);
  assert.equal(world.calls.filter(call => call.kind === 'arc').length, 2);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.stroke === '#ef4444').length, 2);
  assert.ok(world.calls.some(call => call.kind === 'fillText' && call.args[0].includes('休眠瘫痪')));
  assert.ok(world.calls.some(call => call.kind === 'fillText' && call.args[0] === '装甲失效'));
});

test('all living enemy bodies have red circles underneath, corpses hide them and waking restores them', () => {
  const { renderer, world, map, player, state, monster } = setup();
  state.selectedDifficulty = 'easy';
  monster.active = true;
  const hunter = { x: 250, y: 250, angle: 0.8, active: true, dead: false };
  state.heavy = { x: 300, y: 200, angle: 0, active: true, dead: false, phase: 'pursuit' };
  renderer.draw(player, monster, map, state, [hunter]);
  const rings = world.calls.filter(call => call.kind === 'stroke' && call.stroke === '#ef4444');
  assert.equal(rings.length, 3);
  for (const name of ['heavy', 'monster', 'hunter']) {
    const bodyIndex = world.calls.findIndex(call => call.kind === 'drawImage' && call.args[0].src.endsWith(`${name}-topdown.png`));
    assert.ok(world.calls.slice(0, bodyIndex).some(call => call.kind === 'stroke' && call.stroke === '#ef4444'));
  }
  monster.recoverTimer = 20;
  Object.assign(hunter, { dead: true, active: false, corpseTime: 3 });
  Object.assign(state.heavy, { dead: true, active: false, corpseTime: 3 });
  world.calls.length = 0;
  renderer.draw(player, monster, map, state, [hunter]);
  assert.equal(world.calls.filter(call => call.kind === 'arc').length, 0);
  monster.recoverTimer = 0;
  world.calls.length = 0;
  renderer.draw(player, monster, map, state, [hunter]);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.stroke === '#ef4444').length, 1);
});

test('recovering Monster stays down and Hunter or Heavy corpses fade only during their final second', () => {
  const { renderer, world, map, player, state, monster } = setup();
  Object.assign(monster, { active: true, recoverTimer: 4 });
  const hunter = { x: 250, y: 250, angle: 0.8, active: false, dead: true, corpseTime: 3 };
  state.heavy = { x: 300, y: 200, angle: 1.2, active: false, dead: true, corpseTime: 3 };
  for (const [remaining, expectedAlpha] of [[3, 1], [1.5, 1], [0.4, 0.4], [0, null]]) {
    hunter.corpseTime = state.heavy.corpseTime = remaining;
    world.calls.length = 0;
    renderer.draw(player, monster, map, state, [hunter]);
    const images = world.calls.filter(call => call.kind === 'drawImage');
    assert.ok(images.some(call => call.args[0].src.endsWith('monster-down.png') && call.alpha === 1));
    for (const name of ['hunter', 'heavy']) {
      const body = images.find(call => call.args[0].src.endsWith(`${name}-down.png`));
      if (expectedAlpha === null) assert.equal(body, undefined);
      else assert.equal(body?.alpha, expectedAlpha);
    }
    assert.equal(hunter.angle, 0.8);
    assert.equal(state.heavy.angle, 1.2);
  }
  monster.recoverTimer = 0;
  Object.assign(hunter, { active: true, dead: false, corpseTime: 2 });
  Object.assign(state.heavy, { active: true, dead: false, corpseTime: 2 });
  world.calls.length = 0;
  renderer.draw(player, monster, map, state, [hunter]);
  const live = world.calls.filter(call => call.kind === 'drawImage');
  assert.equal(live.length, 3);
  assert.ok(live.every(call => call.args[0].src.endsWith('-topdown.png') && call.alpha === 1));
});

test('off perception combines ambient and a short forward cone before one half-opacity mask composite', () => {
  const { renderer, vision, buffers, map, player, state } = setup();
  for (const flashlight of [false, true]) {
    player.flashlight = flashlight;
    vision.calls.length = 0;
    if (buffers[0]) buffers[0].calls.length = 0;
    renderer.drawCenteredVision(player, map, state);
    assert.equal(buffers.length, 1, 'reuse one perception canvas');
    const composites = vision.calls.filter(call => call.kind === 'drawImage' && call.composite === 'destination-out');
    assert.equal(composites.length, 1);
    assert.equal(composites[0].alpha, flashlight ? 1 : 0.5);
    assert.equal(vision.calls.filter(call => call.kind === 'fill' && call.composite === 'destination-out').length, 0,
      'no second hard erase should overwrite the soft perception field');
    const gradients = buffers[0].calls.filter(call => call.kind === 'gradient').map(call => call.gradient);
    const ranges = gradients.filter(gradient => gradient.kind === 'radial').map(gradient => gradient.args[5]).sort((a, b) => a - b);
    assert.deepEqual(ranges, flashlight ? [74, 420] : [74, 126]);
    for (const gradient of gradients.filter(item => item.kind === 'radial')) {
      assert.ok(gradient.stops.some(([position]) => position === 0.7));
      assert.ok(gradient.stops.some(([position, color]) => position === 1 && color.endsWith(',0)')));
    }
    const edge = gradients.find(gradient => gradient.kind === 'conic');
    assert.ok(edge, 'directional perception fades along both cone sides');
    assert.ok(edge.stops.some(([position, color]) => position > 0 && color.endsWith(',1)')));
    assert.ok(buffers[0].calls.some(call => call.kind === 'fillRect' && call.composite === 'destination-in'));
  }
});

test('perception cone remains clipped at walls and closed doors with the light off', () => {
  const { renderer, buffers, map, player, state } = setup();
  const wall = { x1: 120, y1: 0, x2: 120, y2: 300 };
  const door = { p1: { x: 120, y: 0 }, p2: { x: 120, y: 300 }, open: false };
  for (const blocker of ['wall', 'door', 'open']) {
    map.walls = blocker === 'wall' ? [wall] : [];
    map.doors = blocker !== 'wall' ? [door] : [];
    door.open = blocker === 'open';
    if (buffers[0]) buffers[0].calls.length = 0;
    renderer.drawCenteredVision(player, map, state);
    assert.ok(buffers[0], 'perception must be rendered to its shared buffer');
    const clip = buffers[0].calls.find(call => call.kind === 'clip');
    assert.ok(clip);
    const farX = Math.max(...clip.points.map(point => point[0]));
    if (blocker === 'open') assert.equal(farX, 226);
    else assert.ok(farX <= 128.001, `clipped to ${blocker} plus existing surface reveal`);
  }
});
