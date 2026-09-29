const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function environment() {
  const context = { window: {} };
  vm.createContext(context);
  for (const name of ['config', 'map']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'), context);
  return { context, ...vm.runInContext('({MapManager, Config})', context) };
}

test('all three previews generate automatically while window.game holds a smaller active map', () => {
  const { context, MapManager } = environment();
  const active = new MapManager('small', 1);
  context.window.game = { map: active };
  const signature = active.layoutSignature();
  for (const [scale, rooms] of [['small', 16], ['medium', 26], ['large', 36]]) {
    let preview;
    assert.doesNotThrow(() => { preview = new MapManager(scale, 12345); }, scale);
    assert.equal(preview.functionalRooms.length, rooms);
    assert.equal(preview.worldRooms.filter(room => room.kind === 'room').length, rooms);
    assert.ok(preview.worldRooms.some(room => room.kind === 'corridor'));
    assert.equal(preview.scrap.length, rooms * preview.enemyTypes.length);
    const isolated = environment();
    assert.equal(preview.layoutSignature(), new isolated.MapManager(scale, 12345).layoutSignature());
  }
  assert.equal(active.layoutSignature(), signature);
  assert.equal(context.window.game.map, active);
});

test('collision boundaries belong to the queried map, not the currently active window map', () => {
  const { context, MapManager } = environment();
  context.window.game = { map: { worldW: 100, worldH: 100 } };
  const map = Object.create(MapManager.prototype);
  Object.assign(map, { worldW: 1000, worldH: 800, walls: [], doors: [] });
  assert.equal(map.blocked(500, 500, 10), false);
  assert.equal(map.blocked(995, 500, 10), true);
  assert.equal(map.blocked(500, 795, 10), true);
  context.window.game.map = { worldW: 5000, worldH: 5000 };
  assert.equal(map.blocked(1001, 500, 10), true);
});

test('opening the actual menu automatically fills and paints all three previews with an active game map', () => {
  const { context, MapManager } = environment();
  const frames = [];
  const node = () => ({ children: [], textContent: '', classList: { toggle() {} }, setAttribute() {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } });
  const scales = ['small', 'medium', 'large'];
  const controls = { menuMapConfirm: node(), menuMapReadOnly: node() };
  const cards = scales.map(scale => ({ ...node(), dataset: { draftScale: scale }, querySelector: node }));
  const enemies = Object.fromEntries(scales.map(scale => [scale, node()]));
  const statuses = Object.fromEntries(scales.map(scale => [scale, node()]));
  const ctx = new Proxy({}, { get: (_target, key) => key === 'canvas' ? null : () => {}, set: () => true });
  const canvases = scales.map(scale => ({ dataset: { mapPreview: scale }, clientWidth: 320, clientHeight: 140, getContext: () => ctx }));
  context.window.addEventListener = () => {};
  context.window.game = { map: new MapManager('small', 1), state: { running: false, coop: {} },
    _ensureMenuMapSeeds: () => ({ small: 12345, medium: 12345, large: 12345 }) };
  context.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  context.document = {
    createElement: node, createTextNode: text => ({ textContent: text }), getElementById: id => controls[id],
    querySelectorAll: selector => selector === '[data-map-preview]' ? canvases : selector === '[data-draft-scale]' ? cards : [],
    querySelector: selector => (selector.includes('data-map-enemies') ? enemies : statuses)[selector.match(/="(\w+)"/)[1]]
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/menu.js'), 'utf8'), context);
  const Menu = vm.runInContext('SafehouseMenu', context);
  const menu = Object.create(Menu.prototype);
  menu.game = context.window.game;
  menu.mapDialog = { open: false, showModal() { this.open = true; } };
  menu.openMapDialog();
  assert.equal(Object.keys(menu.mapDraftErrors).length, 0, 'no manual refresh is needed');
  assert.ok(scales.every(scale => enemies[scale].children.length >= 2));
  frames.shift()();
  assert.ok(canvases.every(canvas => canvas.width === 320 && canvas.height === 140));
  assert.ok(scales.every(scale => statuses[scale].textContent.includes('出生点')));
  assert.equal(controls.menuMapConfirm.disabled, false);
});
