const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function fixture({ reduced = false, failed = false } = {}) {
  const listeners = {};
  const frames = new Map();
  let frameId = 0;
  let dialog = false;
  const classes = new Set();
  const media = { matches: reduced, addEventListener(type, fn) { listeners.motionChange = fn; } };
  const makeScene = name => {
    const values = {};
    const images = ['exterior', 'debris', 'cockpit'].map(layer => ({
      dataset: { src: `${name}-${layer}.png` }, complete: false, naturalWidth: 0,
      decode() { return Promise.resolve(); },
      set src(value) { this.url = value; },
    }));
    return { dataset: { menuMotion: name }, hidden: true, images, values,
      style: { setProperty(key, value) { values[key] = value; } },
      querySelectorAll() { return images; } };
  };
  const scenes = [makeScene('title'), makeScene('prep')];
  const document = { hidden: false, body: { classList: { contains: name => classes.has(name) } },
    querySelectorAll: () => scenes, querySelector: () => dialog ? {} : null,
    addEventListener(type, fn) { listeners[type] = fn; } };
  const window = { innerWidth: 1280, innerHeight: 720, matchMedia: () => media,
    addEventListener(type, fn) { listeners[type] = fn; } };
  const sandbox = { window, document, Promise,
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(fs.readFileSync('js/menu.js', 'utf8') + '\nglobalThis.Menu = SafehouseMenu;', sandbox);
  const menu = Object.create(sandbox.Menu.prototype);
  menu.game = { state: { running: false, transitioning: false, coop: { running: false } } };
  menu.screen = 'title';
  assert.equal(typeof menu.initBackgroundMotion, 'function', 'menu must install the background lifecycle');
  menu.initBackgroundMotion();
  const flush = () => { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn()); };
  const settle = async (scene = scenes[0]) => {
    for (const image of scene.images) {
      image.complete = true;
      image.naturalWidth = failed ? 0 : 1672;
      if (failed) image.onerror?.(); else image.onload?.();
    }
    await new Promise(resolve => setImmediate(resolve));
  };
  return { menu, scenes, media, document, window, frames, listeners, classes, flush, settle,
    setDialog(value) { dialog = value; } };
}

test('static background remains until all layers decode; only the visible menu is loaded', async () => {
  const f = fixture();
  assert.equal(f.scenes[0].hidden, true);
  assert.ok(f.scenes[0].images.every(image => image.url));
  assert.ok(f.scenes[1].images.every(image => !image.url));
  await f.settle();
  assert.equal(f.scenes[0].hidden, false);
  assert.equal(f.scenes[0].dataset.running, 'true');
  f.menu.screen = 'prep'; f.menu.syncBackgroundMotion();
  assert.equal(f.scenes[0].hidden, true);
  await f.settle(f.scenes[1]);
  assert.equal(f.scenes[1].hidden, false);
  assert.equal(f.scenes[0].dataset.running, 'false');
});

test('a failed layer falls back to the original without retrying on every sync', async () => {
  const f = fixture({ failed: true });
  await f.settle();
  assert.equal(f.scenes[0].hidden, true);
  f.menu.syncBackgroundMotion();
  assert.equal(f.scenes[0].dataset.running, 'false');
  assert.equal(f.scenes[0].images[0].onload, null);
});

test('hidden tab, descent and mission stop motion; late decoding cannot restart it', async () => {
  const f = fixture();
  f.menu.game.state.transitioning = true;
  f.menu.syncBackgroundMotion();
  await f.settle();
  assert.equal(f.scenes[0].hidden, true);
  f.menu.game.state.transitioning = false;
  f.menu.syncBackgroundMotion();
  assert.equal(f.scenes[0].dataset.running, 'true');
  for (const field of ['running', 'transitioning']) {
    f.menu.game.state[field] = true; f.menu.syncBackgroundMotion();
    assert.equal(f.scenes[0].dataset.running, 'false');
    f.menu.game.state[field] = false;
  }
  f.document.hidden = true; f.listeners.visibilitychange();
  assert.equal(f.scenes[0].hidden, true);
  f.document.hidden = false; f.listeners.visibilitychange();
  assert.equal(f.scenes[0].hidden, false);
  f.classes.add('in-dive'); f.menu.syncBackgroundMotion();
  assert.equal(f.scenes[0].hidden, true);
});

test('reduced motion skips loading and reacts to changes without duplicate listeners', async () => {
  const f = fixture({ reduced: true });
  assert.ok(f.scenes.every(scene => scene.images.every(image => !image.url)));
  const pointerListener = f.listeners.pointermove;
  f.menu.initBackgroundMotion();
  assert.equal(f.listeners.pointermove, pointerListener);
  f.media.matches = false; f.listeners.motionChange();
  await f.settle();
  assert.equal(f.scenes[0].hidden, false);
  f.media.matches = true; f.listeners.motionChange();
  assert.equal(f.scenes[0].hidden, true);
});

test('mouse updates are coalesced and clamped; UI interactions and touch cannot move the scene', async () => {
  const f = fixture(); await f.settle();
  const move = (x, y, extra = {}) => f.listeners.pointermove({ pointerType: 'mouse', buttons: 0, clientX: x, clientY: y, ...extra });
  move(0, 0); move(2000, 1000);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.scenes[0].values['--look-x'], '12px');
  assert.equal(f.scenes[0].values['--look-y'], '12px');
  assert.equal(f.frames.size, 0, 'no permanent render loop');
  move(0, 0, { pointerType: 'touch' });
  assert.equal(f.frames.size, 0);
  move(0, 0, { buttons: 1 });
  assert.equal(f.frames.size, 0);
  f.setDialog(true); move(0, 0);
  assert.equal(f.frames.size, 0);
  f.setDialog(false); f.menu.game._itemDrag = {}; move(0, 0);
  assert.equal(f.frames.size, 0);
  f.menu.game._itemDrag = null;
  move(0, 0); f.setDialog(true); f.flush();
  assert.equal(f.scenes[0].values['--look-x'], '12px', 'recheck lock before rendering a pending pointer event');
  f.setDialog(false);
  f.menu.screen = 'prep'; f.menu.syncBackgroundMotion(); await f.settle(f.scenes[1]);
  move(0, 0); f.flush();
  assert.equal(f.scenes[1].values['--look-x'], '-6px');
  assert.equal(f.scenes[1].values['--look-y'], '-6px');
});

test('leaving a menu cancels pending pointer work and recenters the next visit', async () => {
  const f = fixture(); await f.settle();
  f.listeners.pointermove({ pointerType: 'mouse', buttons: 0, clientX: 1200, clientY: 700 });
  assert.equal(f.frames.size, 1);
  f.menu.game.state.transitioning = true; f.menu.syncBackgroundMotion();
  assert.equal(f.frames.size, 0);
  assert.equal(f.scenes[0].values['--look-x'], '0px');
});
