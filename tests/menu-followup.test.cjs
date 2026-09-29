const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = {
  window: { addEventListener() {}, removeEventListener() {} },
  performance: { now: () => 1000 },
  localStorage: { setItem() {} },
  structuredClone,
  crypto: { getRandomValues(values) { values[0] = 123456; return values; } }
};
for (const [file, name, exported] of [
  ['js/config.js', 'Config', 'Config'],
  ['js/inventory.js', 'BackpackManager', 'BackpackManager'],
  ['js/map.js', 'MapManager', 'MapManager'],
  ['js/game.js', 'Game', 'Game'],
  ['js/menu.js', 'SafehouseMenu', 'SafehouseMenu']
]) vm.runInNewContext(`${fs.readFileSync(path.join(root, file), 'utf8')}\nglobalThis.${exported} = ${name};`, sandbox);

const { Config, BackpackManager, MapManager, Game, SafehouseMenu } = sandbox;

function makeGame(items = [], storage = []) {
  const game = Object.create(Game.prototype);
  game.state = { running: false, inventory: items, storageItems: storage, storageOverflowItems: [], money: 0, coop: { role: null, running: false } };
  game.backpack = BackpackManager.fromType('field');
  game.backpack.items = items;
  game.storageBackpack = new BackpackManager(Config.storage);
  game.storageBackpack.items = storage;
  game.selectedPackIds = new Set();
  game.selectedStorageIds = new Set();
  game.ui = { showToast() {} };
  game._save = () => {};
  game.updateStorageUI = () => {};
  game.updateInventoryUI = () => {};
  game._syncPreparedBackpack = () => {};
  return game;
}

test('vision reveals the complete first rectangular obstacle but not space behind it', () => {
  const map = Object.create(MapManager.prototype);
  map.walls = [{ x: 20, y: -5, w: 30, h: 10 }];
  map.doors = [];
  assert.equal(map.rayVisionDistance(0, 0, 1, 0, 100, 12), 50);
  assert.equal(map.rayVisionDistance(0, 0, 1, 0, 40, 12), 40);
  map.walls = [{ x1: 20, y1: -5, x2: 20, y2: 5 }];
  assert.equal(map.rayVisionDistance(0, 0, 1, 0, 100, 12), 28);
});

test('item art is available before the safehouse menu is constructed', () => {
  assert.equal(BackpackManager.imageFor({ name: '备用氧气瓶', effect: 'oxygen-50' }), 'resources/images/menu/oxygen-bottle.png');
  assert.equal(BackpackManager.imageFor({ name: '光子量子芯片' }), 'resources/images/menu/item-chip.png');
});

test('failed room creation opens a visible error without entering a real room', async () => {
  const game = makeGame();
  game.state.coop.status = '';
  game.updateCoopUI = () => {};
  game.coopSession = { host: async () => { throw new Error('无法创建联机房间'); }, close() {} };
  let shown = '';
  game.menu = { showRoomError(error) { shown = error.message; } };
  await game.hostCoopRoom();
  assert.equal(shown, '无法创建联机房间');
  assert.equal(game.state.coop.role, null);
});

test('settings profile selector edits another difficulty without changing this mission', () => {
  const game = makeGame();
  game.state.selectedDifficulty = 'medium';
  game.state.difficultyProfiles = game._sanitizeDifficultyProfiles();
  game.state.hunterSettings = game._buildDifficultySettings('medium');
  game.state.finalTerminalSettings = game._finalTerminalSettings(game.state.difficultyProfiles.medium);
  game.updateDifficultyUI = () => {};
  game.updateHunterSettingsUI = () => {};
  game.setDifficultyEditor('hard');
  game.updateHunterSetting('small', 'hunterMaxHp', 9);
  assert.equal(game.state.selectedDifficulty, 'medium');
  assert.equal(game.state.difficultyProfiles.hard.maps.small.hunterMaxHp, 9);
  assert.notEqual(game.state.hunterSettings.small.hunterMaxHp, 9);
});

test('equipment labels use current weapons and the carried oxygen count', () => {
  const item = { id: 'oxygen', effect: 'oxygen-50', quickUse: true, shape: '1x2', gx: 0, gy: 0 };
  const game = makeGame([item]);
  game.player = { armory: { loadout: { primary: 'shotgun', sidearm: 'pistol' } } };
  const ids = ['prepPrimaryImage','prepPrimaryName','prepSidearmImage','prepSidearmName','inventoryPrimaryImage','inventoryPrimaryName','inventorySidearmImage','inventorySidearmName','inventoryQuickImage','inventoryQuickName'];
  const nodes = Object.fromEntries(ids.map(id => [id, { src: '', textContent: '', hidden: false, classList: { toggle() {} } }]));
  sandbox.document = { getElementById: id => nodes[id] || null };
  game.updateEquipmentUI();
  assert.match(nodes.prepPrimaryImage.src, /weapon-shotgun\.png$/);
  assert.equal(nodes.prepPrimaryName.textContent, '主武器：散弹枪');
  assert.equal(nodes.inventorySidearmName.textContent, '手枪');
  assert.equal(nodes.inventoryQuickName.textContent, '氧气瓶 ×1 [C]');
});

test('in-mission bag items use the same shaped artwork frame as safehouse items', () => {
  const game = makeGame();
  game.menu = null;
  game.ui.setCurrencyValue = () => {};
  sandbox.document = { createElement(tag) {
    return { tagName: tag, style: {}, children: [], addEventListener() {}, appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); } };
  } };
  const tile = { children: [], appendChild(child) { this.children.push(child); } };
  const item = { id: 'chip', name: '光子量子芯片', shape: '1x1', value: 30, gx: 0, gy: 0, rot: 0 };
  game._renderTileBlocks(tile, item, game.backpack.matrixFor(item), game.backpack, 'inventoryGrid');
  assert.equal(tile.children[0].className, 'bp-art-mask');
  assert.equal(tile.children[0].children[0].src, 'resources/images/menu/item-chip.png');
});

test('melee reaches 55 units without changing knockback distance', () => {
  const game = makeGame();
  game.state.running = true;
  game.player = { x: 100, y: 100, dodgeTimer: 0, downed: false, startMelee: () => true };
  game._remoteEntryForActor = () => null;
  game._tutorialAction = () => {};
  game.map = { blocked: () => false };
  game.monster = { active: false };
  game.audio = {};
  const near = { x: 154, y: 100, radius: 4, active: true, dead: false, registerHit: () => ({ hit: true, dead: false }) };
  const far = { x: 156, y: 100, radius: 4, active: true, dead: false, registerHit: () => ({ hit: true, dead: false }) };
  game.hunters = [near, far];
  assert.equal(game.melee(), true);
  assert.equal(near.x, 204);
  assert.equal(far.x, 156);
  assert.equal(Config.player.meleeKnockback, 50);
});

test('quick-use binding stays on a bag item across dive ID changes and consumes once', () => {
  const item = { id: 'o2-1', name: '备用氧气瓶', effect: 'oxygen-50', shape: '1x2', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  assert.equal(game.assignQuickItem(item.id), true);
  assert.equal(item.quickUse, true);
  game.state.inventory = game._namespacePersistentBackpackItems(game.state.inventory);
  game.backpack.items = game.state.inventory;
  game.state.running = true;
  game.player = { oxygen: 40, downed: false };
  assert.equal(game.useQuickItem(), true);
  assert.equal(game.player.oxygen, 90);
  assert.equal(game.backpack.items.length, 0);
  assert.equal(game.useQuickItem(), false);
});

test('quick-use slot rejects a warehouse oxygen bottle when the bag has no room', () => {
  const filled = Array.from({ length: 40 }, (_, index) => ({ id: `fill-${index}`, shape: '1x1', gx: index % 8, gy: Math.floor(index / 8) }));
  const item = { id: 'oxygen', effect: 'oxygen-50', shape: '1x2', gx: 0, gy: 0 };
  const game = makeGame(filled, [item]);
  assert.equal(game.assignQuickItem(item.id, 'storage'), false);
  assert.equal(game.storageBackpack.items.includes(item), true);
  assert.equal(game.backpack.items.length, 40);
  assert.equal(item.quickUse, undefined);
});

test('menu preview uses a stable seed until refreshed and matches a generated mission', () => {
  const game = makeGame();
  game.map = new MapManager();
  game.state.menuMapSeeds = { small: 45890, medium: 14890, large: 74890 };
  const preview = game.getMenuPreviewMap('small');
  const mission = new MapManager();
  mission.reset('small', 45890);
  assert.equal(preview.layoutSignature(), mission.layoutSignature());
  assert.equal(game.getMenuPreviewMap('small'), preview);
  game.refreshMapPreview('small');
  assert.notEqual(game.getMenuPreviewMap('small').layoutSignature(), preview.layoutSignature());
  assert.equal(game.state.menuMapSeeds.medium, 14890);
});

test('host roster and mission start use the selected preview seed', () => {
  const game = makeGame();
  game.state.coop = { role: 'host', running: false, connected: true, members: [], localReady: true, friendlyFire: true };
  game.state.menuMapSeeds = { small: 111, medium: 222, large: 333 };
  game.state.selectedDifficulty = 'medium';
  game.state.difficultyProfiles = { medium: { maps: {} } };
  game.player = { exportArmory: () => ({}) };
  game.map = { seed: 111 };
  game.coopSession = { sendEvent(type, payload) { this.last = { type, payload }; return true; } };
  game._broadcastCoopRoster();
  assert.equal(game.coopSession.last.payload.mapSeeds.small, 111);
  assert.equal(game.coopSession.last.payload.scale, Config.currentScale);
  game.getCoopStartBlocker = () => null;
  game._finalTerminalSettings = () => ({});
  game._scaleCoopMissionSettings = () => ({ multiplier: 1, hunterSettings: {}, finalTerminalSettings: {} });
  game._beginCoopMission = payload => { game.started = payload; return true; };
  assert.equal(game.startCoopMission(), true);
  assert.equal(game.started.mapSeed, 111);
});

test('host roster includes authoritative equipped weapons for every crew seat', () => {
  const game = makeGame();
  game.state.coop = { role: 'host', connected: true, members: [{ id: 'guest-1', slot: 2, status: 'connected', connected: true, ready: true,
    armory: { loadout: { primary: 'shotgun', sidearm: 'revolver' } } }] };
  game.player = { armory: { loadout: { primary: 'smg', sidearm: 'pistol' } } };
  game.map = { seed: 1 };
  game.state.menuMapSeeds = { small: 1, medium: 2, large: 3 };
  game.state.selectedDifficulty = 'hard';
  game.coopSession = { sendEvent(type, payload) { this.payload = payload; return true; } };
  game._broadcastCoopRoster();
  assert.deepEqual(JSON.parse(JSON.stringify(game.coopSession.payload.hostLoadout)), { primary: 'smg', sidearm: 'pistol' });
  assert.deepEqual(JSON.parse(JSON.stringify(game.coopSession.payload.members[0].loadout)), { primary: 'shotgun', sidearm: 'revolver' });
  assert.equal(game.coopSession.payload.difficulty, 'hard');
});

test('solo descent regenerates the world when the selected preview seed changed', () => {
  const game = makeGame();
  game.state.completed = false;
  game.state.transitioning = false;
  game.state.menuMapSeeds = { small: 888, medium: 222, large: 333 };
  game.map = { seed: 111 };
  game.reset = () => { game.resetCount = (game.resetCount || 0) + 1; game.map.seed = 888; };
  game.audio = { ensureAudio() {}, preloadSound() {} };
  game.ui.showDescentTransition = () => {};
  game._completeDescentTransition = () => {};
  sandbox.setTimeout = () => 1;
  sandbox.window.matchMedia = () => ({ matches: true });
  game.start();
  assert.equal(game.resetCount, 1);
});

test('drag transfer keeps exact target cells and preserves the item footprint', () => {
  const item = { id: 'part', shape: '2x1', gx: 0, gy: 0, rot: 0, value: 90 };
  const game = makeGame([], [item]);
  assert.equal(game._moveGridItemAt(item, game.storageBackpack, game.backpack, 2, 3, 1), true);
  assert.equal(game.storageBackpack.items.length, 0);
  assert.equal(game.backpack.getItem(item.id), item);
  assert.deepEqual([item.gx, item.gy, item.rot], [2, 3, 1]);
  assert.deepEqual([game.backpack.sizeFor(item).w, game.backpack.sizeFor(item).h], [1, 2]);
});

test('invalid drag transfer leaves source item and quick slot unchanged', () => {
  const item = { id: 'oxygen', effect: 'oxygen-50', quickUse: true, shape: '1x2', gx: 0, gy: 0, rot: 0 };
  const blocker = { id: 'blocker', shape: '1x1', gx: 1, gy: 1, rot: 0 };
  const game = makeGame([item], [blocker]);
  assert.equal(game._moveGridItemAt(item, game.backpack, game.storageBackpack, 1, 1, 0), false);
  assert.deepEqual([item.gx, item.gy, item.rot], [0, 0, 0]);
  assert.equal(game.backpack.getItem(item.id), item);
  assert.equal(item.quickUse, true);
  assert.equal(game._moveGridItemAt(item, game.backpack, game.storageBackpack, 4, 4, 0), true);
  assert.equal(game.getQuickItem(), null);
});

test('dropping a warehouse item over the backpack grid transfers it to the hovered cells', () => {
  const item = { id: 'part', shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([], [item]);
  const storageGrid = { id: 'storageGrid' };
  const bagGrid = { id: 'prepBackpackGrid' };
  sandbox.document = { getElementById: id => ({ storageGrid, prepBackpackGrid: bagGrid })[id] || null };
  game._gridMetrics = grid => ({ left: grid === bagGrid ? 100 : 0, top: 0, stepX: 10, stepY: 10 });
  game._itemDrag = {
    item, tile: {}, metrics: { left: 0, top: 0, stepX: 10, stepY: 10 }, manager: game.storageBackpack, gridId: 'storageGrid', kind: 'storage', rot: 0,
    grabX: 0, grabY: 0, pointerX: 121, pointerY: 31, startX: 1, startY: 1, moved: true
  };
  game._handleItemDragEnd();
  assert.equal(game.backpack.getItem(item.id), item);
  assert.deepEqual([item.gx, item.gy], [2, 3]);
});

test('cross-grid drag clears old selection when a duplicate item ID is renamed', () => {
  const stored = { id: 'same', shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const carried = { id: 'same', shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([carried], [stored]);
  game.selectedStorageIds.add('same');
  const bagGrid = { id: 'prepBackpackGrid' };
  sandbox.document = { getElementById: id => id === 'prepBackpackGrid' ? bagGrid : null };
  game._gridMetrics = () => ({ left: 100, top: 0, stepX: 10, stepY: 10 });
  game._itemDrag = {
    item: stored, tile: {}, metrics: { left: 0, top: 0, stepX: 10, stepY: 10 },
    manager: game.storageBackpack, gridId: 'storageGrid', kind: 'storage', rot: 0,
    grabX: 0, grabY: 0, pointerX: 121, pointerY: 21, startX: 1, startY: 1, moved: true
  };
  game._handleItemDragEnd();
  assert.equal(game.selectedStorageIds.has('same'), false);
  assert.equal(game.selectedPackIds.has(stored.id), true);
  assert.notEqual(stored.id, 'same');
});

test('dropping oxygen over the quick-use slot binds it without removing its bag cells', () => {
  const item = { id: 'oxygen', shape: '1x2', effect: 'oxygen-50', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  let syncs = 0;
  game._syncPreparedBackpack = () => { syncs++; };
  const bagGrid = { id: 'prepBackpackGrid' };
  const quickSlot = { getBoundingClientRect: () => ({ left: 220, top: 0, right: 270, bottom: 80 }) };
  sandbox.document = { getElementById: id => ({ prepBackpackGrid: bagGrid, quickUseSlot: quickSlot })[id] || null };
  game._gridMetrics = () => ({ left: 100, top: 0, stepX: 10, stepY: 10 });
  game._itemDrag = {
    item, tile: {}, metrics: { left: 100, top: 0, stepX: 10, stepY: 10 }, manager: game.backpack, gridId: 'prepBackpackGrid', kind: 'prepared', rot: 0,
    grabX: 0, grabY: 0, pointerX: 230, pointerY: 20, startX: 101, startY: 1, moved: true
  };
  game._handleItemDragEnd();
  assert.equal(game.getQuickItem(), item);
  assert.equal(game.backpack.usedCells(), 2);
  assert.equal(syncs, 1);
});

test('a drop onto C cannot be immediately undone by the same gesture click', () => {
  const item = { id: 'oxygen', shape: '1x2', effect: 'oxygen-50', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  const quickSlot = { getBoundingClientRect: () => ({ left: 220, top: 0, right: 270, bottom: 80 }) };
  sandbox.document = { getElementById: id => id === 'quickUseSlot' ? quickSlot : null };
  game._itemDrag = {
    item, tile: {}, metrics: { left: 100, top: 0, stepX: 10, stepY: 10 }, manager: game.backpack,
    gridId: 'prepBackpackGrid', kind: 'prepared', rot: 0, grabX: 0, grabY: 0,
    pointerX: 230, pointerY: 20, startX: 101, startY: 1, moved: true
  };
  game._handleItemDragEnd();
  assert.equal(game.getQuickItem(), item);
  assert.equal(game.handleQuickSlotClick(), false);
  assert.equal(game.getQuickItem(), item);
});

test('a canceled touch drag restores the source without binding oxygen', () => {
  const item = { id: 'oxygen', shape: '1x2', effect: 'oxygen-50', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  let redraws = 0;
  game.updateStorageUI = () => { redraws++; };
  sandbox.document = { getElementById: id => id === 'quickUseSlot'
    ? { getBoundingClientRect: () => ({ left: 220, top: 0, right: 270, bottom: 80 }), classList: { remove() {} } } : null };
  game._itemDrag = {
    item, tile: {}, manager: game.backpack, kind: 'prepared', rot: 0,
    gx: 0, gy: 0, pointerX: 230, pointerY: 20, moved: true
  };
  game._handleItemDragEnd({ type: 'pointercancel' });
  assert.equal(game.getQuickItem(), null);
  assert.deepEqual([item.gx, item.gy], [0, 0]);
  assert.equal(redraws, 1);
});

test('rejected quick-slot drops restore the source grid instead of leaving a ghost tile', () => {
  const item = { id: 'scrap', shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  let redraws = 0;
  game.updateStorageUI = () => { redraws++; };
  sandbox.document = { getElementById: id => id === 'quickUseSlot'
    ? { getBoundingClientRect: () => ({ left: 220, top: 0, right: 270, bottom: 80 }) } : null };
  game._itemDrag = {
    item, tile: {}, metrics: { left: 100, top: 0, stepX: 10, stepY: 10 },
    manager: game.backpack, gridId: 'prepBackpackGrid', kind: 'prepared', rot: 0,
    grabX: 0, grabY: 0, pointerX: 230, pointerY: 20, startX: 101, startY: 1, moved: true
  };
  game._handleItemDragEnd();
  assert.equal(game.backpack.getItem(item.id), item);
  assert.equal(redraws, 1);
});

test('mission preview draws structure and spawn without reading hidden contents', () => {
  const calls = { strokes: 0, spawns: 0, labels: 0 };
  const context = {
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    stroke() { calls.strokes++; }, arc() { calls.spawns++; }, fillText() { calls.labels++; }
  };
  const canvas = { clientWidth: 320, clientHeight: 180, width: 0, height: 0, getContext: () => context };
  const map = {
    worldRooms: [{ vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] }],
    doors: [{ p1: { x: 40, y: 0 }, p2: { x: 55, y: 0 } }],
    spawnPoint: { x: 25, y: 25 },
    get scrap() { throw new Error('loot must remain hidden'); },
    get terminals() { throw new Error('terminals must remain hidden'); }
  };
  const menu = Object.create(SafehouseMenu.prototype);
  menu.drawMapPreview(canvas, map);
  assert.ok(calls.strokes >= 2);
  assert.ok(calls.spawns >= 1);
  assert.equal(calls.labels, 0);
});

test('next mission candidates reroll after settlement, while guests await host seeds', () => {
  const game = makeGame();
  game.state.menuMapSeeds = { small: 1, medium: 2, large: 3 };
  game._menuPreviewMaps = { small: { seed: 1 } };
  assert.equal(game._rollNextMenuMaps(), true);
  assert.equal(game.state.menuMapSeeds.small, 123456);
  assert.equal(game._menuPreviewMaps.small, undefined);
  game.state.coop.role = 'guest';
  assert.equal(game._rollNextMenuMaps(), false);
  assert.equal(game.state.menuMapSeeds.small, 123456);
});

test('loadout damage reads each weapon configuration including pellet total', () => {
  assert.equal(SafehouseMenu.weaponDamageText({ damage: 2, pelletCount: 4 }), '每弹丸 2 · 四弹丸全中最多 8');
  assert.equal(SafehouseMenu.weaponDamageText({ damage: 1, penetrationTargets: 3 }), '单发伤害 1 · 最多命中 3 个目标');
  assert.equal(SafehouseMenu.weaponDamageText({ damage: 1, penetrationTargets: 1 }), '单发伤害 1');
});

test('host processes one remote oxygen-use request only once', () => {
  const game = makeGame();
  const player = { angle: 0 };
  game.state.coop = { role: 'host', hostPaused: false };
  game.remotePlayers = new Map([['guest', { player, online: true }]]);
  let uses = 0;
  game._useOxygenBottle = () => { uses++; return true; };
  game._handleRemoteAction({ action: 'use-oxygen', itemId: 'bottle' }, 'guest');
  assert.equal(uses, 1);
});

test('host map scale change synchronizes the next layout choice to the lobby', () => {
  const game = makeGame();
  game.state.coop = { role: 'host', running: false };
  game.state.armory = { loadout: { primary: null, sidearm: 'pistol' } };
  game.state.menuMapSeeds = { small: 1, medium: 2, large: 3 };
  game.map = { reset() {}, terminals: [] };
  game.player = { reset() {}, armory: {} };
  game.monster = { reset() {} };
  game._getHunterSettings = () => ({ hunterSpawnInterval: 20 });
  game._createHunters = () => [];
  game.ui = { updateScaleButtons() {}, updateTerminalsStatus() {}, log() {}, showToast() {} };
  game.resetFullMapView = () => {};
  game.updateHunterSettingsUI = () => {};
  game.render = () => {};
  game.menu = { queueRefresh() {} };
  let broadcasts = 0;
  game._broadcastCoopRoster = () => { broadcasts++; };
  game.setMapScale('medium');
  assert.equal(broadcasts, 1);
});

test('warehouse and bag tiles can be selected by keyboard without starting a mission', () => {
  const game = makeGame();
  let selected = null;
  game.togglePreparedPackItemSelection = id => { selected = id; };
  const tile = { listeners: {}, setAttribute(name, value) { this[name] = value; }, addEventListener(name, handler) { this.listeners[name] = handler; } };
  game._bindPreparedTileKeyboard(tile, { id: 'oxygen' }, 'backpack');
  let stopped = false;
  tile.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(selected, 'oxygen');
  assert.equal(stopped, true);
  assert.equal(tile.tabIndex, 0);
});

test('Shift+Enter transfers the focused warehouse item without visible transfer buttons', () => {
  const item = { id: 'part', shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([], [item]);
  let saves = 0;
  game._save = () => { saves++; };
  const tile = { listeners: {}, setAttribute() {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  game._bindPreparedTileKeyboard(tile, item, 'storage');
  let stopped = false;
  tile.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(game.storageBackpack.getItem(item), null);
  assert.equal(game.backpack.getItem(item), item);
  assert.equal(saves, 1);
  assert.equal(stopped, true);
});

test('Shift+Enter leaves a focused item untouched when the destination is full', () => {
  const item = { id: 'part', shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const filled = Array.from({ length: 40 }, (_, index) => ({ id: `filled-${index}`, shape: '1x1', gx: index % 8, gy: Math.floor(index / 8), rot: 0 }));
  const game = makeGame(filled, [item]);
  let saves = 0;
  game._save = () => { saves++; };
  const tile = { listeners: {}, setAttribute() {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  game._bindPreparedTileKeyboard(tile, item, 'storage');
  tile.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(game.storageBackpack.getItem(item), item);
  assert.equal(game.backpack.items.length, 40);
  assert.equal(saves, 0);
});

test('Shift+Enter returns a bound oxygen bottle to storage and clears its C binding', () => {
  const item = { id: 'oxygen', effect: 'oxygen-50', quickUse: true, shape: '1x2', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  const tile = { listeners: {}, setAttribute() {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  game._bindPreparedTileKeyboard(tile, item, 'backpack');
  tile.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(game.backpack.getItem(item), null);
  assert.equal(game.storageBackpack.getItem(item), item);
  assert.equal(item.quickUse, undefined);
});

test('keyboard users can bind a selected oxygen bottle through the quick slot button', () => {
  const item = { id: 'oxygen', effect: 'oxygen-50', shape: '1x2', gx: 0, gy: 0 };
  const game = makeGame([item]);
  game.selectedPackIds.add('oxygen');
  assert.equal(game.toggleQuickItemFromSelection(), true);
  assert.equal(game.getQuickItem(), item);
  assert.equal(game.toggleQuickItemFromSelection(), true);
  assert.equal(game.getQuickItem(), null);
  assert.equal(game.backpack.items.length, 1);
});

test('discarding a quick-use bottle removes its binding before leaving the bag', () => {
  const item = { id: 'oxygen', effect: 'oxygen-50', quickUse: true, shape: '1x2', gx: 0, gy: 0, rot: 0 };
  const game = makeGame([item]);
  game.player = { x: 100, y: 100 };
  game.map = { scrap: [] };
  game.ui.log = () => {};
  game.selectedItemId = item.id;
  assert.equal(game.discardItem(), true);
  assert.equal(item.quickUse, undefined);
  assert.equal(game.getQuickItem(), null);
});

test('solo Esc menu pauses simulation until it closes and clears movement input', () => {
  const game = makeGame();
  game.state.running = true;
  game.state.elapsed = 10;
  game.state.keys = { w: true };
  game.state.fireHeld = true;
  game.player = { oxygen: 50 };
  game.ui.setPauseMenuVisible = () => {};
  game.audio = { stopMissionAudio() {}, beginMissionAudio() {} };
  assert.equal(game.togglePauseMenu(true), true);
  game.update(1);
  assert.equal(game.state.elapsed, 10);
  assert.equal(game.player.oxygen, 50);
  assert.equal(game.state.keys.w, undefined);
  assert.equal(game.togglePauseMenu(false), true);
  assert.equal(game.state.pauseMenuOpen, false);
});

test('host closing Esc menu stays paused while the window remains unfocused', () => {
  const game = makeGame();
  game.state.running = true;
  game.state.coop = { role: 'host', running: true, connected: true, hostPaused: false, focusPaused: false };
  game.remotePlayers = new Map();
  game.ui.setPauseMenuVisible = () => {};
  game.ui.setCoopPaused = () => {};
  game.audio = { stopMissionAudio() {}, beginMissionAudio() {} };
  game.coopSession = { sent: [], sendEvent(type, payload) { this.sent.push({ type, payload }); return true; } };
  sandbox.document = { visibilityState: 'hidden', hasFocus: () => false };
  game._handleCoopFocusChange();
  game.togglePauseMenu(true);
  game.togglePauseMenu(false);
  assert.equal(game.state.coop.hostPaused, true);
  assert.equal(game.coopSession.sent.at(-1).payload.paused, true);
});

test('guest abandon sends a request without ending the host mission locally', () => {
  const game = makeGame();
  game.state.running = true;
  game.state.coop = { role: 'guest', running: true, connected: true, playerId: 'guest-1' };
  game.coopSession = { sent: [], sendEvent(type, payload) { this.sent.push({ type, payload }); return true; } };
  let finishes = 0;
  game.finish = () => { finishes++; };
  assert.equal(game.abandonMission(), true);
  assert.equal(game.coopSession.sent[0].type, 'abandon-request');
  assert.equal(finishes, 0);
});

test('host settles and removes only the guest who requested abandon', () => {
  const game = makeGame();
  game.state.running = true;
  game.state.coop = { role: 'host', running: true };
  const player = { exportArmory: () => ({ loadout: { primary: null, sidearm: 'pistol' } }) };
  game.remotePlayers = new Map([['guest-1', { player, online: true }]]);
  let settlements = 0;
  let removals = 0;
  game._settlePlayerAmmo = () => { settlements++; };
  game._removeCoopMember = () => { removals++; game.remotePlayers.delete('guest-1'); };
  game._shouldFailMission = () => false;
  game.coopSession = { sent: [], sendEvent(type, payload, target) { this.sent.push({ type, payload, target }); return true; } };
  assert.equal(game._handleCoopAbandonRequest({}, 'guest-1'), true);
  assert.equal(game.coopSession.sent[0].type, 'finish');
  assert.equal(game.coopSession.sent[0].target, 'guest-1');
  assert.equal(game.coopSession.sent[0].payload.abandoned, true);
  assert.equal(settlements, 1);
  assert.equal(removals, 1);
  assert.equal(game.state.running, true);
});

test('departing guest applies personal failure and leaves the room after host confirmation', () => {
  const game = makeGame();
  game.state.coop = { role: 'guest', running: true };
  let failure = null;
  let left = 0;
  game.finish = success => { failure = success; };
  game.leaveCoopRoom = () => { left++; };
  game._finishGuestCoop({ success: false, abandoned: true });
  assert.equal(failure, false);
  assert.equal(left, 1);
  assert.equal(game.state.coop.running, false);
});
