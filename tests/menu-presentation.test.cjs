const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const file = path.join(__dirname, '../js/menu.js');
const sandbox = { window: { addEventListener() {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8'), sandbox);
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nglobalThis.Menu = SafehouseMenu;', sandbox);

function makeMenu(coop = { role: null }) {
  assert.equal(typeof sandbox.Menu, 'function', 'The live menu controller must exist');
  const menu = Object.create(sandbox.Menu.prototype);
  menu.game = { state: { running: false, coop }, leaveCoopRoom() { this.state.coop.role = null; } };
  menu.setScreen = screen => { menu.screen = screen; };
  menu.confirmLeave = async () => false;
  return menu;
}
test('entering preparation does not start a mission', () => {
  const menu = makeMenu();
  menu.enterPreparation();
  assert.equal(menu.screen, 'prep');
  assert.equal(menu.game.state.running, false);
});
test('return to title preserves a joined lobby when leave is cancelled', async () => {
  const menu = makeMenu({ role: 'guest', running: false });
  menu.screen = 'prep';
  assert.equal(await menu.returnToTitle(), false);
  assert.equal(menu.game.state.coop.role, 'guest');
  assert.equal(menu.screen, 'prep');
});
test('return to title leaves the room only after confirmation', async () => {
  const menu = makeMenu({ role: 'host', running: false });
  menu.confirmLeave = async () => true;
  assert.equal(await menu.returnToTitle(), true);
  assert.equal(menu.game.state.coop.role, null);
  assert.equal(menu.screen, 'title');
});
test('menu navigation cannot hide an active mission', async () => {
  const menu = makeMenu();
  menu.game.state.running = true;
  assert.equal(await menu.returnToTitle(), false);
  menu.enterPreparation();
  assert.equal(menu.screen, undefined);
});
test('navigation stays locked while the descent transition is active', () => {
  const menu = makeMenu();
  menu.game.state.transitioning = true;
  menu.enterPreparation();
  assert.equal(menu.screen, undefined);
});
test('a mission beginning during the leave confirmation cannot be abandoned by that dialog', async () => {
  const menu = makeMenu({ role: 'guest', running: false });
  menu.screen = 'prep';
  menu.confirmLeave = async () => { menu.game.state.coop.running = true; return true; };
  assert.equal(await menu.returnToTitle(), false);
  assert.equal(menu.screen, 'prep');
  assert.equal(menu.game.state.coop.role, 'guest');
});
test('menu scaling gives warehouse and backpack the same pitch without changing capacity', () => {
  assert.equal(typeof sandbox.Menu, 'function');
  const warehouse = { cols: 10, rows: 10, cellSize: 34, gap: 4, capacity: 100 };
  const bag = { cols: 8, rows: 5, cellSize: 34, gap: 4, capacity: 40 };
  const scale = sandbox.Menu.gridScale(warehouse, bag, 450, 360, 420);
  assert.ok(scale >= 1 && scale <= 1.2);
  assert.equal(warehouse.capacity, 100);
  assert.equal(bag.capacity, 40);
  assert.equal(sandbox.Menu.gridScale(warehouse, bag, 10, 10, 10), 1);
});

test('detail popup reads current card data on every click and leaves the card unchanged', () => {
  const menu = makeMenu();
  const classes = new Set();
  const dialog = { open: false, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) }, showModal() { this.open = true; }, close() { this.open = false; } };
  menu.detailDialog = dialog;
  menu.detailTitle = { textContent: '' };
  menu.detailBody = { replaceChildren(...nodes) { this.nodes = nodes; } };
  menu.detailImage = { hidden: false, src: '', alt: '' };
  let value = '备弹 120';
  const detail = { get textContent() { return value; }, cloneNode() { return { textContent: value, removeAttribute() {}, querySelectorAll() { return []; } }; } };
  const card = { classList: { contains: () => false }, matches: () => false, querySelectorAll: () => [detail], querySelector: selector => selector.includes('h2') ? { textContent: '弹药' } : null };
  const button = { focused: 0, focus() { this.focused++; } };
  sandbox.window.matchMedia = () => ({ matches: true });
  menu.openDetail(card, button);
  assert.equal(dialog.open, true);
  assert.equal(menu.detailBody.nodes[0].textContent, '备弹 120');
  assert.equal(card.classList.contains('detail-open'), false);
  menu.closeDetail();
  assert.equal(dialog.open, false);
  assert.equal(button.focused, 1);
  value = '备弹 85';
  menu.openDetail(card, button);
  assert.equal(menu.detailBody.nodes[0].textContent, '备弹 85');
});

test('detail popup waits for its close animation before releasing the modal', () => {
  const menu = makeMenu();
  const classes = new Set(['is-open']);
  menu.detailDialog = { open: true, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) }, close() { this.open = false; } };
  const button = { focused: 0, focus() { this.focused++; } };
  menu.detailReturnFocus = button;
  sandbox.window.matchMedia = () => ({ matches: false });
  let timer;
  sandbox.setTimeout = (callback, delay) => { timer = { callback, delay }; return 1; };
  menu.closeDetail();
  assert.equal(menu.detailDialog.open, true);
  assert.equal(timer.delay, 200);
  timer.callback();
  assert.equal(menu.detailDialog.open, false);
  assert.equal(button.focused, 1);
});

test('closing a detail popup before its first animation frame cannot re-open its visual state', () => {
  const menu = makeMenu();
  const classes = new Set();
  menu.detailDialog = { open: false, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) }, showModal() { this.open = true; }, close() { this.open = false; } };
  menu.detailTitle = { textContent: '' };
  menu.detailBody = { replaceChildren() {} };
  menu.detailImage = { hidden: false };
  const detail = { textContent: '说明', cloneNode() { return { removeAttribute() {}, querySelectorAll() { return []; } }; } };
  const card = { matches: () => false, querySelectorAll: () => [detail], querySelector: selector => selector.includes('h2') ? { textContent: '测试' } : null };
  const button = { focus() {} };
  sandbox.window.matchMedia = () => ({ matches: false });
  let frame;
  sandbox.requestAnimationFrame = callback => { frame = callback; };
  sandbox.setTimeout = () => 1;
  menu.openDetail(card, button);
  menu.closeDetail();
  frame();
  assert.equal(classes.has('is-open'), false);
});

test('ammo submenus show one panel without resetting stored input values', () => {
  const menu = makeMenu();
  const panels = Object.fromEntries(['purchase', 'transfer', 'oxygen'].map(name => [name, { hidden: name !== 'purchase', inputValue: '100' }]));
  const buttons = Object.keys(panels).map(name => ({ dataset: { ammoSection: name }, setAttribute(key, value) { this[key] = value; } }));
  sandbox.document = {
    getElementById: id => panels[id.replace('ammoSection', '').toLowerCase()] || null,
    querySelectorAll: () => buttons
  };
  menu.selectAmmoSection('transfer');
  assert.equal(panels.purchase.hidden, true);
  assert.equal(panels.transfer.hidden, false);
  assert.equal(panels.oxygen.hidden, true);
  assert.equal(buttons[1]['aria-selected'], 'true');
  assert.equal(panels.transfer.inputValue, '100');
});

test('whole-card detail activation ignores nested purchase and settings controls', () => {
  const menu = makeMenu();
  let opens = 0;
  menu.openDetail = () => { opens++; return true; };
  const card = {};
  const nestedAction = { target: { closest: () => ({ tagName: 'BUTTON' }) } };
  const imageClick = { target: { closest: () => null } };
  assert.equal(menu.activateDetailCard(card, nestedAction), false);
  assert.equal(menu.activateDetailCard(card, imageClick), true);
  assert.equal(opens, 1);
});

test('clicking artwork inside a role-button mission card opens its detail', () => {
  const menu = makeMenu();
  let opens = 0;
  menu.openDetail = () => { opens++; return true; };
  const card = { tagName: 'ARTICLE' };
  const art = { closest: () => card };
  assert.equal(menu.activateDetailCard(card, { target: art }), true);
  assert.equal(opens, 1);
});

test('offline crew preview stays presentation-only and can be dismissed', () => {
  const menu = makeMenu();
  let refreshes = 0;
  menu.updateLobby = () => { refreshes++; };
  assert.equal(menu.setOfflineCrewPreview(true), true);
  assert.equal(menu.offlineCrewPreview, true);
  assert.equal(menu.game.state.coop.role, null);
  assert.equal(menu.setOfflineCrewPreview(false), true);
  assert.equal(menu.offlineCrewPreview, false);
  assert.equal(refreshes, 2);
});

test('local room API failure explains the missing endpoint and offers preview', () => {
  const menu = makeMenu();
  const message = { textContent: '' };
  const preview = { hidden: true };
  menu.roomErrorDialog = { open: false, showModal() { this.open = true; } };
  sandbox.window.location = { hostname: 'localhost' };
  sandbox.document = { getElementById: id => ({ coopRoomErrorMessage: message, coopRoomErrorPreview: preview })[id] };
  menu.showRoomError(Object.assign(new Error('无法创建联机房间'), { status: 501 }));
  assert.match(message.textContent, /api\/rooms/);
  assert.equal(preview.hidden, false);
  assert.equal(menu.roomErrorDialog.open, true);
});

test('map dialog keeps scale and refreshed seed as drafts until confirmation', () => {
  const menu = makeMenu();
  menu.game.state.menuMapSeeds = { small: 11, medium: 22, large: 33 };
  menu.game._newMenuSeed = () => 44;
  menu.game._menuPreviewMaps = {};
  let committedScale = '';
  menu.game.setMapScale = scale => { committedScale = scale; };
  menu._refreshMapDialog = () => {};
  menu.mapDialog = { open: true, close() { this.open = false; } };
  menu.mapDraft = { scale: 'small', seeds: { ...menu.game.state.menuMapSeeds } };
  menu.selectDraftMapScale('medium');
  menu.refreshDraftMapPreview('medium');
  assert.equal(committedScale, '');
  assert.equal(menu.game.state.menuMapSeeds.medium, 22);
  menu.cancelMapDraft();
  assert.equal(menu.game.state.menuMapSeeds.medium, 22);
  menu.mapDraft = { scale: 'medium', seeds: { small: 11, medium: 44, large: 33 } };
  menu.mapDialog.open = true;
  menu.commitMapDraft();
  assert.equal(committedScale, 'medium');
  assert.equal(menu.game.state.menuMapSeeds.medium, 44);
});
