const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { performance: { now: () => 0 } };
vm.runInNewContext(fs.readFileSync('js/player-art.js', 'utf8'), context);
const PlayerArt = vm.runInNewContext('PlayerArt', context);
const state = () => ({ running: true, missionFxId: 'test', coop: {}, textureQuality: 'high' });
const player = () => ({ x: 100, y: 100, angle: 0, weaponId: 'pistol', moveSpeed: 70 });

test('actual distance advances walk and sprint phases independently of elapsed time', () => {
  const art = new PlayerArt(() => null), p = player(), s = state();
  assert.equal(art.pose(p, s, 'local', 0), 0);
  p.x += 17.5; art.pose(p, s, 'local', 1000);
  assert.equal(art.poses.get('local').phase, 2);
  assert.equal(art.pose(p, s, 'local', 1500), 0);
  assert.equal(art.poses.get('local').phase, 2);
  assert.equal(art.poses.get('local').mode, 'idle');
  p.moveSpeed = 150; p.x += 25; art.pose(p, s, 'local', 1501);
  assert.equal(art.poses.get('local').phase, 4);
});

test('movement direction is relative to facing with inclusive forward and backward diagonals', () => {
  const cases = [
    [10, 0, 0, 'forward'], [10, -10, 0, 'forward'], [10, 10, 0, 'forward'],
    [-10, 0, 0, 'backward'], [-10, -10, 0, 'backward'], [-10, 10, 0, 'backward'],
    [0, -10, 0, 'left'], [0, 10, 0, 'right'], [0, 10, Math.PI / 2, 'forward'],
    [0, -10, Math.PI / 2, 'backward'], [10, 0, Math.PI / 2, 'left'],
    [-10, 0, Math.PI / 2, 'right'], [-10, 0, Math.PI * 2, 'backward']
  ];
  for (const [dx, dy, angle, mode] of cases) {
    const art = new PlayerArt(() => null), p = player(), s = state();
    p.angle = angle; art.pose(p, s, 'local', 0); p.x += dx; p.y += dy;
    const frame = art.pose(p, s, 'local', 20);
    assert.ok(frame >= 1 && frame <= 4);
    assert.equal(art.poses.get('local').mode, mode, `${dx},${dy} facing ${angle}`);
  }
});

test('walk phase matches across render cadences and sprint begins at speed 145', () => {
  const art = new PlayerArt(() => null), one = player(), many = player(), s = state();
  art.pose(one, s, 'one', 0); art.pose(many, s, 'many', 0);
  one.x += 26.25; art.pose(one, s, 'one', 10);
  for (let step = 1; step <= 3; step++) {
    many.x += 8.75; art.pose(many, s, 'many', step * 100);
  }
  assert.equal(art.poses.get('one').phase, 3);
  assert.equal(art.poses.get('many').phase, 3);
  many.moveSpeed = 145; many.x += 12.5; art.pose(many, s, 'many', 400);
  assert.equal(art.poses.get('many').phase, 4);
});

test('any nonzero displacement animates and a 48-unit step is not a teleport', () => {
  const art = new PlayerArt(() => null), p = player(), s = state();
  art.pose(p, s, 'local', 0); p.x += 0.001;
  assert.equal(art.pose(p, s, 'local', 100), 1);
  assert.ok(art.poses.get('local').phase > 0);
  art.reset('local'); art.pose(p, s, 'local', 200); p.x += 48;
  assert.equal(art.pose(p, s, 'local', 300), 2);
  assert.ok(art.poses.get('local').phase > 5);
});

test('pause and stun freeze a frame, downed uses its pose, and a new mission resets history', () => {
  const art = new PlayerArt(() => null), p = player(), s = state();
  art.pose(p, s, 'peer', 0); p.x += 5;
  const walking = art.pose(p, s, 'peer', 125);
  s.coop.hostPaused = true; p.x += 5; assert.equal(art.pose(p, s, 'peer', 250), walking);
  s.coop.hostPaused = false; p.stunned = 1; assert.equal(art.pose(p, s, 'peer', 375), walking);
  p.stunned = 0; p.downed = true; assert.equal(art.pose(p, s, 'peer', 500), 5);
  p.downed = false; s.missionFxId = 'next'; assert.equal(art.pose(p, s, 'peer', 625), 0);
});

test('revival clears the downed pose even while simulation is paused', () => {
  const art = new PlayerArt(() => null), p = player(), s = state();
  p.downed = true; assert.equal(art.pose(p, s, 'local', 0), 5);
  p.downed = false; s.pauseMenuOpen = true;
  assert.equal(art.pose(p, s, 'local', 100), 0);
  assert.equal(art.poses.get('local').mode, 'idle');
});

test('all pause and stun states freeze phase while consuming position updates', () => {
  const freezes = [
    (p, s) => { s.running = false; }, (p, s) => { s.pauseMenuOpen = true; },
    (p, s) => { s.tutorial = { paused: true }; }, (p, s) => { s.coop.hostPaused = true; },
    p => { p.stunned = 1; }, p => { p.flashStunTimer = 1; }
  ];
  for (const freeze of freezes) {
    const art = new PlayerArt(() => null), p = player(), s = state();
    art.pose(p, s, 'local', 0); p.x += 8.75;
    const walking = art.pose(p, s, 'local', 100);
    freeze(p, s); p.x += 8.75;
    assert.equal(art.pose(p, s, 'local', 200), walking);
    assert.equal(art.poses.get('local').phase, 1);
    Object.assign(s, state(), { pauseMenuOpen: false, tutorial: {} });
    p.stunned = 0; p.flashStunTimer = 0;
    assert.equal(art.pose(p, s, 'local', 300), 0);
    assert.equal(art.poses.get('local').phase, 1);
  }
});

test('reduced motion uses idle layers and corrections over 48 reset animation history', () => {
  let reduced = false;
  const art = new PlayerArt(() => null, () => reduced), p = player(), s = state();
  art.pose(p, s, 'local', 0); p.x += 8.75; art.pose(p, s, 'local', 100);
  reduced = true; p.x += 8.75;
  assert.equal(art.pose(p, s, 'local', 200), 0);
  assert.equal(art.poses.get('local').mode, 'idle');
  assert.equal(art.poses.get('local').phase, 1);
  reduced = false; p.x += 49;
  assert.equal(art.pose(p, s, 'local', 300), 0);
  assert.equal(art.poses.get('local').phase, 0);
  p.x += 8.75; assert.equal(art.pose(p, s, 'local', 400), 2);
});

test('reset clears one actor or all actors without carrying previous movement into rejoin', () => {
  const art = new PlayerArt(() => null), p = player(), s = state();
  art.pose(p, s, 'local', 0); art.pose(p, s, 'peer', 0);
  p.x += 8.75; art.pose(p, s, 'local', 100); art.pose(p, s, 'peer', 100);
  art.reset('peer'); p.x += 8.75;
  assert.equal(art.pose(p, s, 'peer', 200), 0);
  assert.equal(art.pose(p, s, 'local', 200), 3);
  art.reset(); p.x += 8.75;
  assert.equal(art.pose(p, s, 'local', 300), 0);
  assert.equal(art.pose(p, s, 'peer', 300), 0);
});

test('low quality does not load art and all six guns retain separate sprites', () => {
  const loaded = [], image = { complete: true, naturalWidth: 1536, naturalHeight: 1024 };
  const art = new PlayerArt(name => { loaded.push(name); return image; });
  const calls = [], ctx = { drawImage(...args) { calls.push(args); } };
  const p = player(), s = state();
  s.textureQuality = 'low'; assert.equal(art.draw(ctx, p, s, 'local', 0), false); assert.equal(loaded.length, 0);
  s.textureQuality = 'high';
  for (const id of ['pistol', 'smg', 'shotgun', 'revolver', 'machinegun', 'mini-shotgun']) {
    p.weaponId = id; assert.equal(art.draw(ctx, p, s, 'local', 10), true);
    assert.ok(loaded.includes(`player-v20/${id}`));
  }
  assert.equal(new PlayerArt(() => ({ complete: false })).draw(ctx, p, s, 'local', 20), false);
  assert.equal(calls.length, 18);
});

test('missing, incomplete and zero-size required layers fall back before drawing', () => {
  for (const missing of ['player-tactical-v1/upper-short', 'player-tactical-v1/legs-idle',
    'player-tactical-v1/legs-walk', 'player-v20/pistol']) {
    for (const bad of [null, { complete: false, naturalWidth: 100, naturalHeight: 100 },
      { complete: true, naturalWidth: 0, naturalHeight: 100 },
      { complete: true, naturalWidth: 100, naturalHeight: 0 }]) {
      const art = new PlayerArt(name => name === missing ? bad :
        { complete: true, naturalWidth: 400, naturalHeight: 400 });
      let draws = 0;
      assert.equal(art.draw({ drawImage() { draws++; } }, player(), state(), 'local', 0), false, missing);
      assert.equal(draws, 0);
    }
  }
});

test('upper and idle stay centered at 40 units while walk rows use calibrated 20-unit quads', () => {
  const images = new Map();
  const art = new PlayerArt(name => {
    if (!images.has(name)) images.set(name, { name, complete: true, naturalWidth: 400, naturalHeight: 400 });
    return images.get(name);
  });
  const calls = [], ctx = { drawImage(...args) { calls.push(args); } }, p = player(), s = state();
  assert.equal(art.draw(ctx, p, s, 'local', 0), true);
  assert.equal(calls[0][0].name, 'player-tactical-v1/legs-idle');
  assert.equal(calls[1][0].name, 'player-tactical-v1/upper-short');
  assert.deepEqual(calls[0].slice(5), [-20, -20, 40, 40]);
  assert.deepEqual(calls[1].slice(5), [-20, -20, 40, 40]);
  for (const [dx, dy, row] of [[8.75, 0, 0], [-8.75, 0, 1], [0, -8.75, 2], [0, 8.75, 3]]) {
    art.reset('local'); art.pose(p, s, 'local', 0); p.x += dx; p.y += dy; calls.length = 0;
    assert.equal(art.draw(ctx, p, s, 'local', 100), true);
    assert.equal(calls[0][0].name, 'player-tactical-v1/legs-walk');
    assert.deepEqual(calls[0].slice(1, 5), [100, row * 100, 100, 100]);
    assert.deepEqual(calls[0].slice(7), [20, 20]);
  }
  p.weaponId = 'shotgun'; calls.length = 0; art.draw(ctx, p, s, 'local', 200);
  assert.equal(calls[1][0].name, 'player-tactical-v1/upper-long');
});

test('all sixteen generated walk waist probes meet the idle hip seam without moving the actor', () => {
  const probes = [
    [[275, 178], [266, 177.5], [271, 177.5], [266, 177.5]],
    [[279, 178.5], [273, 178.5], [269, 178], [266, 178.5]],
    [[275, 177.5], [273, 177.5], [271, 177.5], [269, 177]],
    [[276, 149.5], [273, 150.5], [270, 149.5], [266, 150]]
  ];
  const art = new PlayerArt(name => ({ name, complete: true, naturalWidth: 1254, naturalHeight: 1254 }));
  const directions = [[1, 0], [-1, 0], [0, -1], [0, 1]], s = state();
  const calls = [], ctx = { drawImage(...args) { calls.push(args); } };
  const targetX = 538 / 1254 * 40 - 20, targetY = 625.5 / 1254 * 40 - 20;
  for (let row = 0; row < 4; row++) {
    for (let phase = 0; phase < 4; phase++) {
      const p = player(), identity = `${row}:${phase}`, distance = phase * 8.75 + 0.875;
      art.pose(p, s, identity, 0);
      p.x += directions[row][0] * distance; p.y += directions[row][1] * distance;
      const before = JSON.stringify(p); calls.length = 0;
      assert.equal(art.draw(ctx, p, s, identity, 100), true);
      assert.equal(JSON.stringify(p), before);
      const legs = calls[0], [probeX, probeY] = probes[row][phase];
      assert.deepEqual(legs.slice(1, 5), [phase * 313.5, row * 313.5, 313.5, 313.5]);
      assert.deepEqual(legs.slice(7), [20, 20]);
      assert.ok(Math.abs(legs[5] + probeX / 313.5 * legs[7] - targetX) < 1e-9, identity);
      assert.ok(Math.abs(legs[6] + probeY / 313.5 * legs[8] - targetY) < 1e-9, identity);
      assert.deepEqual(calls[1].slice(5), [-20, -20, 40, 40]);
    }
  }
});

test('downed body keeps the V20 frame-five crop and hip pivot with the existing gun anchor', () => {
  const art = new PlayerArt(name => ({ name, complete: true, naturalWidth: 1536, naturalHeight: 1024 }));
  const calls = [], ctx = { drawImage(...args) { calls.push(args); } }, p = player();
  p.downed = true;
  assert.equal(art.draw(ctx, p, state(), 'local', 0), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0].name, 'player-v20/short-poses');
  assert.deepEqual(calls[0].slice(1, 5), [1024, 512, 512, 512]);
  assert.deepEqual(calls[0].slice(5), [-247.5 / 512 * 40, -260 / 512 * 40, 40, 40]);
  assert.ok(Math.abs(calls[1][5] - 7.64) < 1e-12);
});

test('visual muzzle offsets never mutate player position or attack angle', () => {
  const p = player(), before = JSON.stringify(p);
  const distance = PlayerArt.muzzleDistance('shotgun');
  assert.ok(distance > PlayerArt.muzzleDistance('pistol'));
  assert.equal(JSON.stringify(p), before);
});

test('spread pellets share the rendered gun muzzle while authoritative rays stay unchanged', () => {
  const p = { x: 100, y: 50, angle: 0, weaponId: 'shotgun' };
  const muzzle = PlayerArt.muzzlePoint(p, 'shotgun');
  const starts = [];
  for (const angle of [-Math.PI / 9, Math.PI / 9]) {
    const trace = { startX: 100, startY: 50, currentX: 100 + Math.cos(angle) * 80,
      currentY: 50 + Math.sin(angle) * 80, endX: 100 + Math.cos(angle) * 300, endY: 50 + Math.sin(angle) * 300 };
    const before = JSON.stringify(trace);
    const segment = PlayerArt.tracerSegment(trace, muzzle);
    starts.push([segment.startX, segment.startY]);
    assert.equal(JSON.stringify(trace), before);
  }
  assert.deepEqual(starts[0], starts[1]);
  assert.equal(starts[0][1], 50);
});

test('remote fire flash uses the interpolated visible player, not the authority position', () => {
  vm.runInNewContext(fs.readFileSync('js/renderer.js', 'utf8'), context);
  const Renderer = vm.runInNewContext('Renderer', context);
  const renderer = Object.create(Renderer.prototype), translations = [];
  renderer.lowQuality = false;
  renderer.playerArt = { assets: () => ({}) };
  renderer.playerDisplayPositions = new Map([['peer', { x: 100, y: 50, angle: 0 }]]);
  renderer.visibleWorldPoint = () => true;
  const ctx = { save() {}, restore() {}, translate(x, y) { translations.push([x, y]); },
    rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {} };
  renderer.drawPlayerMuzzleFlashes(ctx, {}, { rayWallDistance: (_x, _y, _dx, _dy, d) => d },
    { muzzleFlashes: [{ shooterId: 'peer', weaponId: 'pistol', x: 115, y: 50, angle: 0, timer: .18 }] });
  assert.deepEqual(translations[0], [100 + PlayerArt.muzzleDistance('pistol'), 50]);
});

test('player snapshots preserve sprint speed and ordinary stun for remote visual poses', () => {
  const simulation = { window: { addEventListener() {} }, structuredClone };
  for (const name of ['config', 'inventory', 'entities', 'game']) vm.runInNewContext(fs.readFileSync(`js/${name}.js`, 'utf8'), simulation);
  const { Game, Player } = vm.runInNewContext('({ Game, Player })', simulation);
  const g = Object.create(Game.prototype), p = new Player();
  g.player = p; g.state = { coop: {} }; g._remoteEntryForActor = () => null;
  p.moveSpeed = 150; p.stunned = 2.5;
  const snapshot = g._playerSnapshot(p), remote = new Player();
  assert.equal(snapshot.moveSpeed, 150); assert.equal(snapshot.stunned, 2.5);
  g._applyPlayerSnapshot(remote, snapshot, 1);
  assert.equal(remote.moveSpeed, 150); assert.equal(remote.stunned, 2.5);
});
