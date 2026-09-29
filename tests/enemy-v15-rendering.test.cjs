const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function canvas() {
  const calls = [], stack = [];
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() { stack.push([this.globalAlpha, this.globalCompositeOperation]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation] = stack.pop(); },
    createPattern() { return 'pattern'; },
    createRadialGradient() { return { addColorStop() {} }; },
    createConicGradient() { return { addColorStop() {} }; }
  };
  for (const kind of ['setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect', 'strokeRect',
    'fill', 'stroke', 'arc', 'clip', 'fillText', 'drawImage', 'setLineDash', 'closePath', 'rect', 'beginPath', 'moveTo', 'lineTo']) {
    ctx[kind] = function (...args) { calls.push({ kind, args, alpha: this.globalAlpha, width: this.lineWidth, stroke: this.strokeStyle }); };
  }
  return { width: 800, height: 600, clientWidth: 800, clientHeight: 600, style: {}, calls, ctx, getContext: () => ctx };
}

function setup() {
  const buffers = [];
  let now = 0;
  const sandbox = { performance: { now: () => now }, clearTimeout,
    Image: class { constructor() { this.complete = true; this.naturalWidth = this.naturalHeight = 512; } },
    window: { matchMedia: () => ({ matches: false }) },
    document: { createElement() { const result = canvas(); buffers.push(result); return result; } }
  };
  for (const [file, symbol] of [['config', 'Config'], ['inventory', 'BackpackManager'], ['map', 'MapManager'], ['renderer', 'Renderer'], ['audio', 'AudioManager']]) {
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8')}\nglobalThis.${symbol} = ${symbol};`, sandbox);
  }
  Object.assign(sandbox.Config.hunter, { spriteWidth: 63 });
  Object.assign(sandbox.Config.monster, { spriteWidth: 72 });
  Object.assign(sandbox.Config.heavy, { spriteWidth: 112 });
  const world = canvas(), vision = canvas();
  const renderer = new sandbox.Renderer({ canvas: world, ctx: world.ctx, visionCanvas: vision, visionCtx: vision.ctx });
  const room = { x: 0, y: 0, w: 400, h: 300, lights: [] };
  const map = Object.assign(Object.create(sandbox.MapManager.prototype), {
    worldW: 4000, worldH: 2000, worldRooms: [room], walls: [], doors: [], terminals: [], scrap: [], windows: []
  });
  const player = { x: 100, y: 100, angle: 0, flashlight: false, armory: {} };
  const state = { selectedDifficulty: 'easy', elapsed: 0, cameraZoom: 1, bulletTraces: [], impactParticles: [], heavies: [], corpses: [] };
  const monster = { x: 180, y: 150, angle: 0, active: false };
  renderer.prepareCamera(player, state);
  return { renderer, map, player, state, monster, world, vision, room, buffers, sandbox, setTime: value => { now = value; } };
}

test('configured actor sizes and each heavy charge corridor use the enlarged bodies', () => {
  const { renderer, map, player, state, monster, world } = setup();
  monster.active = true;
  const hunter = { x: 170, y: 100, angle: 0, active: true };
  state.heavies = [0, 1].map(id => ({ id, x: 220, y: 150 + id * 100, angle: 0, radius: 44, active: true, phase: 'windup' }));
  renderer.draw(player, monster, map, state, [hunter]);
  const images = world.calls.filter(call => call.kind === 'drawImage' && /(?:hunter|monster|heavy)-topdown/.test(call.args[0].src));
  assert.deepEqual(images.map(call => call.args[3]), [112, 112, 72, 63]);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.width === 88).length, 2);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.stroke === '#ef4444').length, 4);
  state.selectedDifficulty = 'hard'; world.calls.length = 0;
  renderer.draw(player, monster, map, state, [hunter]);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.width === 88).length, 0);
  state.heavy = state.heavies[0]; state.heavies = []; world.calls.length = 0;
  renderer.draw(player, monster, map, state, [hunter]);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && /heavy-topdown/.test(call.args[0].src)).length, 0);
});

test('medium and hard render all Nightmares without easy-only red rings', () => {
  const { renderer, map, player, state, monster, world } = setup();
  state.nightmares=[{...monster,active:true,id:'n1'},{...monster,x:220,active:true,id:'n2'}];
  for(const difficulty of ['easy','medium','hard']){
    world.calls.length=0;state.selectedDifficulty=difficulty;
    renderer.draw(player,monster,map,state,[]);
    assert.equal(world.calls.filter(call=>call.kind==='drawImage'&&/monster-topdown/.test(call.args[0].src)).length,2);
    assert.equal(world.calls.filter(call=>call.kind==='stroke'&&call.stroke==='#ef4444').length,difficulty==='easy'?2:0);
  }
});

test('medium and hard danger cues are muted without disabling actual Heavy footsteps', () => {
  const {sandbox,setTime}=setup();setTime(1000);
  const audio=new sandbox.AudioManager(),gains=[],tones=[];let steps=0;
  audio.context={currentTime:1};audio.proximityGain={gain:{setTargetAtTime:value=>gains.push(value)}};
  audio.proximityOscillator={frequency:{setTargetAtTime(){}}};audio.proximityPanner={pan:{setTargetAtTime(){}}};
  audio.lastClawSound=1000;audio.updateHeavyFootsteps=()=>steps++;
  audio.playSpatialTone=(...args)=>tones.push(args);
  audio.update({x:0,y:0,angle:0},{active:true,alerted:true,x:30,y:0,radius:22.5},
    {rayWallDistance:()=>9999},[],[],{dangerCues:false});
  assert.equal(steps,1);assert.equal(tones.length,0);assert.equal(gains.at(-1),0);
});

test('corpse registry is authoritative, culled, faded and drawn with shared images without rings', () => {
  const { renderer, map, player, state, monster, world } = setup();
  const dead = { x: 160, y: 100, angle: 0, active: false, dead: true, corpseTime: 3 };
  state.heavies = [dead];
  state.corpses = [
    { id: 'a', kind: 'hunter', x: 150, y: 100, angle: 0, width: 63, fadeRemaining: null },
    { id: 'b', kind: 'hunter', x: 180, y: 100, angle: 0, width: 63, fadeRemaining: .25 },
    { id: 'c', kind: 'heavy', x: 10000, y: 10000, angle: 0, width: 112, fadeRemaining: null }
  ];
  renderer.draw(player, monster, map, state, [dead]);
  const corpses = world.calls.filter(call => call.kind === 'drawImage' && /-down\.png$/.test(call.args[0].src));
  assert.equal(corpses.length, 2);
  assert.equal(corpses[0].args[0], corpses[1].args[0]);
  assert.deepEqual(corpses.map(call => call.alpha), [1, .25]);
  assert.equal(world.calls.filter(call => call.kind === 'stroke' && call.stroke === '#ef4444').length, 0);
  state.corpses = []; monster.active = true; monster.recoverTimer = 2; world.calls.length = 0;
  renderer.draw(player, monster, map, state, [dead]);
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && /monster-down\.png$/.test(call.args[0].src)).length, 1);
});

test('faulty strips vary slowly, cache contributions, match tubes and obey reduced motion and blackout', () => {
  const { renderer, map, player, state, monster, world, vision, room, buffers } = setup();
  room.lights = ['normal', 'flicker', 'off'].map((status, index) => ({ id: String(index), state: status, phase: .35,
    x1: 20, x2: 380, y1: 20 + index * 20, y2: 20 + index * 20, range: 500 }));
  renderer.motionQuery.matches = true;
  renderer.draw(player, monster, map, state, []);
  const tubes = world.calls.filter(call => call.kind === 'stroke' && call.width === 3 && call.stroke === '#c5eff4');
  assert.deepEqual(tubes.map(call => call.alpha), [1, .5]);
  renderer.drawCenteredVision(player, map, state);
  const lights = vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5);
  assert.deepEqual(lights.map(call => call.alpha), [1], 'normal and faulty light erase fog once as a max-composed mask');
  const count = buffers.length;
  renderer.motionQuery.matches = false;
  const levels = [];
  for (const elapsed of [0, .1, 1, 3, 5]) {
    state.elapsed = elapsed;
    vision.calls.length = 0;
    renderer.drawCenteredVision(player, map, state);
    assert.equal(vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5).length, 1);
    levels.push(renderer.roomLightField(room, state).levels[0]);
  }
  assert.equal(buffers.length, count, 'changing intensity must not allocate room buffers');
  assert.ok(new Set(levels).size > 2);
  assert.ok(Math.abs(levels[0] - levels[1]) < .15, 'no rapid strobe');
  state.powerLossStartedAt = 0; state.elapsed = 3; vision.calls.length = 0;
  renderer.drawCenteredVision(player, map, state);
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5).length, 0);
});

test('camera shake is composed in the same world units as look and recoil', () => {
  const { renderer, player, state } = setup();
  const x = renderer.cameraOffsetX, y = renderer.cameraOffsetY;
  Object.assign(state, { cameraLookX: 10, cameraLookY: 20, recoilX: 2, recoilY: -3, shakeX: 1.5, shakeY: -.5 });
  renderer.prepareCamera(player, state);
  assert.equal(renderer.cameraOffsetX, x - 13.5);
  assert.equal(renderer.cameraOffsetY, y - 16.5);
});

test('40/100/200 visible corpses cost one draw each and offscreen corpses cost no draws', t => {
  const { renderer, map, player, state, monster, world } = setup();
  for (const count of [40, 100, 200]) {
    state.corpses = Array.from({ length: count }, (_, id) => ({ id: `corpse-${id}`, kind: 'hunter',
      x: 150, y: 100, angle: 0, width: 63, fadeRemaining: null }));
    world.calls.length = 0;
    renderer.draw(player, monster, map, state, []);
    const draws = world.calls.filter(call => call.kind === 'drawImage' && /hunter-down\.png$/.test(call.args[0].src)).length;
    assert.equal(draws, count);
    t.diagnostic(`${count} corpses: ${draws} corpse drawImage calls; fixture JSON ${Buffer.byteLength(JSON.stringify(state.corpses))} bytes`);
    state.corpses.forEach(corpse => { corpse.x = 10000; });
    world.calls.length = 0;
    renderer.draw(player, monster, map, state, []);
    assert.equal(world.calls.filter(call => call.kind === 'drawImage' && /hunter-down\.png$/.test(call.args[0].src)).length, 0);
  }
});

test('heavy footsteps keep independent cadences and reset across removal and mission stop', () => {
  const { sandbox, player, map, setTime } = setup();
  const audio = new sandbox.AudioManager(), tones = [];
  audio.context = { currentTime: 0 };
  audio.playSpatialTone = (...args) => tones.push(args);
  const heavies = [{ id: 'a', x: 150, y: 100, active: true, phase: 'pursuit' },
    { id: 'b', x: 100, y: 150, active: true, phase: 'charge' }];
  audio.update(player, { active: false }, map, [], heavies);
  setTime(300); heavies.forEach(heavy => heavy.x += 10);
  audio.update(player, { active: false }, map, [], heavies);
  assert.deepEqual(tones.map(tone => tone[0]), [74, 135]);
  setTime(900); heavies.forEach(heavy => heavy.x += 10);
  audio.update(player, { active: false }, map, [], heavies);
  assert.deepEqual(tones.map(tone => tone[0]), [74, 135, 55, 108, 74, 135]);
  audio.update(player, { active: false }, map, [], []);
  setTime(2000); heavies.forEach(heavy => heavy.x += 10);
  audio.update(player, { active: false }, map, [], heavies);
  assert.equal(tones.length, 6, 'returning actors establish new cadence');
  audio.stopMissionAudio(); audio.missionAudioMuted = false;
  setTime(3000); heavies.forEach(heavy => heavy.x += 10);
  audio.update(player, { active: false }, map, [], heavies);
  assert.equal(tones.length, 6, 'pause/stop clears all cadence history');
});
