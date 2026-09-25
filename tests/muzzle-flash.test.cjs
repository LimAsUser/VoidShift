const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = {};
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js/config.js'), 'utf8')}\nglobalThis.ConfigUnderTest = Config;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js/map.js'), 'utf8')}\nglobalThis.MapManagerUnderTest = MapManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js/renderer.js'), 'utf8')}\nglobalThis.RendererUnderTest = Renderer;`, sandbox);
const MapManager = sandbox.MapManagerUnderTest;
const Renderer = sandbox.RendererUnderTest;

test('room-boundary ray distance clips a muzzle flash to a rectangular room', () => {
  const map = Object.create(MapManager.prototype);
  const distance = map.roomBoundaryDistance({ x: 0, y: 0, w: 200, h: 100 }, 50, 50, 1, 0);
  assert.equal(distance, 150);
});

test('room-boundary ray distance supports procedural polygon rooms', () => {
  const map = Object.create(MapManager.prototype);
  const room = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 80, y: 100 }, { x: 20, y: 100 }] };
  const distance = map.roomBoundaryDistance(room, 50, 50, 1, 0);
  assert.ok(Math.abs(distance - 40) < 0.001);
});

test('observer visibility polygon stops at its own wall instead of exposing a remote room', () => {
  const renderer = Object.create(Renderer.prototype);
  const map = {
    rayVisionDistance: (_x, _y, dx, _dy, maxDistance) => dx > 0.99 ? 25 : maxDistance
  };

  const polygon = renderer.visibilityPolygon({ x: 0, y: 0 }, map, 100, 4);

  assert.equal(polygon[0].x, 25);
  assert.ok(Math.abs(polygon[0].y) < 0.001);
});
