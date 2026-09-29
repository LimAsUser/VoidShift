const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function canvas() {
  const calls = [];
  let segments = [], start, current;
  const ctx = {
    beginPath() { segments = []; start = current = null; },
    moveTo(x, y) { start = current = [x, y]; },
    lineTo(x, y) { if (current) segments.push([...current, x, y]); current = [x, y]; },
    closePath() { if (start) this.lineTo(...start); },
    stroke() { calls.push({ kind: 'stroke', segments: segments.slice(), color: this.strokeStyle }); },
    fill() { calls.push({ kind: 'fill', segments: segments.slice(), color: this.fillStyle }); },
    fillRect(...rect) { calls.push({ kind: 'fillRect', rect, color: this.fillStyle }); },
    strokeRect(x, y, w, h) {
      this.beginPath(); this.moveTo(x, y); this.lineTo(x + w, y);
      this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); this.stroke();
    }
  };
  for (const name of ['save', 'restore', 'setTransform', 'translate', 'scale', 'rotate', 'clearRect', 'arc', 'fillText']) ctx[name] = () => {};
  return { width: 800, height: 600, clientWidth: 800, clientHeight: 600, ctx, calls, getContext: () => ctx };
}

function setup() {
  const sandbox = { window: { devicePixelRatio: 1, matchMedia: () => ({ matches: true }), addEventListener() {} } };
  for (const [file, name] of [['config', 'Config'], ['map', 'MapManager'], ['renderer', 'Renderer'], ['menu', 'SafehouseMenu']]) {
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8')}\nglobalThis.${name} = ${name};`, sandbox);
  }
  const segment = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
  const room = x => ({ x, y: 0, w: 400, h: 300, label: 'CORRIDOR', discovered: true,
    center: { x: x + 200, y: 150 }, vertices: [{ x, y: 0 }, { x: x + 400, y: 0 }, { x: x + 400, y: 300 }, { x, y: 300 }] });
  const a = room(0), b = room(400);
  a.wallSegments = [segment(0, 0, 120, 0), segment(220, 0, 400, 0), segment(400, 0, 400, 100),
    segment(400, 200, 400, 300), segment(400, 300, 0, 300), segment(0, 300, 0, 0)];
  b.wallSegments = [segment(400, 0, 800, 0), segment(800, 0, 800, 300), segment(800, 300, 400, 300),
    segment(400, 300, 400, 200), segment(400, 100, 400, 0)];
  const passage = { isPassage: true, open: true, p1: { x: 400, y: 100 }, p2: { x: 400, y: 200 }, roomA: a, roomB: b };
  const door = { open: false, p1: { x: 120, y: 0 }, p2: { x: 220, y: 0 }, roomA: a };
  a.doors = [passage, door]; b.doors = [passage];
  const box = { x: 50, y: 50, w: 25, h: 25, isBox: true };
  const map = { worldRooms: [a, b], walls: [...a.wallSegments, ...b.wallSegments, box], doors: [door], passages: [passage],
    terminals: [], getRoomAt: () => a };
  const mini = canvas(), full = canvas(), preview = canvas();
  const renderer = new sandbox.Renderer({ miniCtx: mini.ctx, fullMapCanvas: full, fullMapCtx: full.ctx, updateFullMapStats() {} });
  const menu = Object.create(sandbox.SafehouseMenu.prototype);
  const player = { x: 200, y: 150, angle: 0 };
  const draw = {
    minimap: () => renderer.drawMiniMap(player, map),
    fullmap: () => renderer.drawFullMap(player, map),
    preview: () => menu.drawMapPreview(preview, map)
  };
  return { map, draw, surfaces: { minimap: mini, fullmap: full, preview }, project: (view, x, y) =>
    view === 'preview' ? [12 + x * .97, 154.5 + y * .97] : [x, y] };
}

function crossesPoint(call, [x, y]) {
  return call.segments?.some(([x1, y1, x2, y2]) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    return length > 0 && Math.abs((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)) < .001 &&
      Math.hypot(x - x1, y - y1) + Math.hypot(x - x2, y - y2) <= length + .001;
  });
}

for (const view of ['minimap', 'fullmap', 'preview']) {
  test(`${view} preserves floor fill and real doors without drawing a wall across an open passage`, () => {
    const f = setup(); f.draw[view]();
    const strokes = f.surfaces[view].calls.filter(call => call.kind === 'stroke');
    assert.ok(!strokes.some(call => crossesPoint(call, f.project(view, 400, 150))), 'the passage must remain a visible gap');
    assert.ok(strokes.some(call => crossesPoint(call, f.project(view, 400, 50))), 'structural walls next to the gap remain');
    assert.ok(strokes.some(call => call.color === (view === 'preview' ? '#91aabb' : '#e8754e') &&
      crossesPoint(call, f.project(view, 150, 0))), 'the closed physical door remains visible');
    assert.ok(f.surfaces[view].calls.some(call => call.kind === 'fill' && crossesPoint(call, f.project(view, 400, 150))), 'floor polygons stay filled');
    if (view !== 'preview') assert.ok(f.surfaces[view].calls.some(call => call.kind === 'fillRect' && call.rect.join() === '50,50,25,25'), 'cargo AABB stays visible');
  });

  test(`${view} accepts legacy maps without passages or room wall segments`, () => {
    const f = setup(); delete f.map.passages;
    f.map.worldRooms.forEach(room => { delete room.wallSegments; room.doors = []; });
    assert.doesNotThrow(() => f.draw[view]());
    assert.ok(f.surfaces[view].calls.some(call => call.kind === 'stroke' && crossesPoint(call, f.project(view, 400, 150))), 'legacy polygon outline remains available');
  });
}

test('undiscovered full-map outlines also leave the passage open', () => {
  const f = setup(); f.map.worldRooms.forEach(room => { room.discovered = false; }); f.draw.fullmap();
  const outlines = f.surfaces.fullmap.calls.filter(call => call.kind === 'stroke' && call.color === 'rgba(101, 221, 235, 0.28)');
  assert.ok(outlines.length);
  assert.ok(!outlines.some(call => crossesPoint(call, [400, 150])));
});
