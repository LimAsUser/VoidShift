const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function element() {
  const classes = new Set();
  return {
    children: [], dataset: {}, style: {}, attributes: {}, listeners: {}, textContent: '', hidden: false,
    classList: { add: name => classes.add(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; this.rebuilds = (this.rebuilds || 0) + 1; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return name === 'src' ? this.src : this.attributes[name]; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelector(selector) { return this.children.flatMap(child => [child, ...(child.children || [])]).find(child => child.className === selector.slice(1)) || null; }
  };
}

function fixture() {
  const nodes = new Map(), calls = [];
  const get = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const document = {
    createElement: element, createTextNode: text => ({ textContent: text }),
    getElementById: id => get(`#${id}`),
    querySelector: selector => get(selector), querySelectorAll: () => []
  };
  const context = { document, window: { addEventListener() {}, game: {
    purchaseWeaponAmmo: id => calls.push(id), equipWeapon: (...args) => calls.push(args)
  } }, requestAnimationFrame() {} };
  for (const [file, name, exported] of [['config', 'Config', 'Config'], ['ui', 'UIManager', 'UI'], ['menu', 'SafehouseMenu', 'Menu'], ['inventory', 'BackpackManager', 'Backpack']]) {
    vm.runInNewContext(fs.readFileSync(`js/${file}.js`, 'utf8') + `\nglobalThis.${exported} = ${name};`, context);
  }
  const ui = Object.create(context.UI.prototype);
  ui.loadoutCards = {}; ui.loadoutPurchaseButtons = {}; ui.loadoutEquipButtons = {};
  ui.weaponAmmoCatalog = get('#weaponAmmoCatalog');
  for (const name of ['hudSupplyProgress', 'hudSupplyProgressBar', 'hudSupplyProgressLabel', 'hudShield', 'hudShieldBar', 'hudShieldStatus', 'hudParty']) ui[name] = get(`#${name}`);
  const menu = Object.create(context.Menu.prototype);
  return { ...context, ui, menu, get, calls };
}

test('new weapons become primary and sidearm cards and equip their configured slot', () => {
  const f = fixture();
  f.document.querySelector = selector => selector.startsWith('#loadout') ? null : f.get(selector);
  f.ui.ensureLoadoutCards();
  const primary = f.get('[aria-labelledby="primarySlotTitle"] .loadout-grid');
  const sidearm = f.get('[aria-labelledby="sidearmSlotTitle"] .loadout-grid');
  assert.ok(primary.children.includes(f.ui.loadoutCards.machinegun));
  assert.ok(sidearm.children.includes(f.ui.loadoutCards['mini-shotgun']));
  f.ui.loadoutEquipButtons['mini-shotgun'].listeners.click();
  assert.deepEqual(f.calls, [['sidearm', 'mini-shotgun']]);
  const count = primary.children.length + sidearm.children.length;
  f.ui.ensureLoadoutCards();
  assert.equal(primary.children.length + sidearm.children.length, count);
});

test('dedicated ammo purchases respect ownership, price and task lock', () => {
  const f = fixture(), armory = { ownedWeapons: { machinegun: true }, weaponAmmo: {} };
  f.ui.updateWeaponAmmoShop(armory, 200, false);
  assert.equal(f.ui.weaponAmmoCards.machinegun.button.disabled, false);
  assert.equal(f.ui.weaponAmmoCards['mini-shotgun'].button.disabled, true);
  f.ui.weaponAmmoCards.machinegun.button.listeners.click();
  assert.deepEqual(f.calls, ['machinegun']);
  armory.ownedWeapons['mini-shotgun'] = true;
  f.ui.updateWeaponAmmoShop(armory, 50, false);
  assert.equal(f.ui.weaponAmmoCards.machinegun.button.disabled, true);
  assert.equal(f.ui.weaponAmmoCards['mini-shotgun'].button.disabled, false);
  f.ui.updateWeaponAmmoShop(armory, 999, true);
  assert.equal(f.ui.weaponAmmoCards['mini-shotgun'].button.disabled, true);
  assert.equal(f.ui.weaponAmmoCatalog.children.length, 2);
});

test('standard conversion keeps the original four ammunition types and excludes dedicated rounds', () => {
  const f = fixture();
  f.ui.ammoTransferSources = element(); f.ui.ammoTransferTargets = element();
  const armory = { standardAmmoUnits: 100, ownedWeapons: {}, weaponAmmo: {} };
  for (const id of Object.keys(f.Config.weapons)) { armory.ownedWeapons[id] = true; armory.weaponAmmo[id] = { magazine: 1, reserve: 10 }; }
  f.ui.updateAmmoDepot(armory);
  assert.equal(f.ui.ammoTransferSources.children.length, 5);
  const labels = f.ui.ammoTransferSources.children.map(button => button.children.at(-1).children[0].textContent);
  assert.deepEqual(new Set(labels), new Set(['标准弹药库', '手枪', '冲锋枪', '左轮', '散弹枪']));
});

test('timed supply and barrier removal progress use mission time and shield cooldown stays bounded', () => {
  const f = fixture();
  const player = { armory: { equippedPassive: 'shield' }, supplyUse: { effect: 'oxygen-50', endsAt: 12 }, shieldUntil: 0, shieldReadyAt: 50 };
  f.ui.updateEquipmentStatus(player, { elapsed: 11, coop: {} }, []);
  assert.equal(f.ui.hudSupplyProgress.hidden, false);
  assert.equal(f.ui.hudSupplyProgressBar.style.width, '50%');
  assert.equal(f.ui.hudShieldBar.style.width, '22%');
  player.supplyUse = null; player.barrierRemoval = { endsAt: 14 };
  f.ui.updateEquipmentStatus(player, { elapsed: 12.5, coop: {} }, []);
  assert.equal(f.ui.hudSupplyProgressBar.style.width, '50%');
  assert.match(f.ui.hudSupplyProgressLabel.textContent, /拆除/);
  player.barrierRemoval = null; player.shieldUntil = 15;
  f.ui.updateEquipmentStatus(player, { elapsed: 13, coop: {} }, []);
  assert.equal(f.ui.hudSupplyProgress.hidden, true);
  assert.match(f.ui.hudShieldStatus.textContent, /生效/);
});

test('party cards keep their DOM between frames and display downed revive status', () => {
  const f = fixture();
  const player = { armory: {} }, teammate = { health: 25, oxygen: 63, downed: true, reviveProgress: 1.5 };
  const party = [{ id: 'local', slot: 1, local: true, online: true, player }, { id: 'ally', slot: 2, local: false, online: true, player: teammate }];
  f.ui.updateEquipmentStatus(player, { elapsed: 1, coop: { running: true } }, party);
  assert.equal(f.ui.hudParty.children.length, 1);
  const card = f.ui.hudParty.children[0];
  assert.match(f.ui.partyStatusCards.ally.status.textContent, /倒地/);
  assert.match(f.ui.partyStatusCards.ally.vitals.textContent, /25.*63/);
  teammate.health = 40;
  f.ui.updateEquipmentStatus(player, { elapsed: 2, coop: { running: true } }, party);
  assert.equal(f.ui.hudParty.children[0], card);
  assert.match(f.ui.partyStatusCards.ally.vitals.textContent, /40/);
  f.ui.updateEquipmentStatus(player, { elapsed: 2, coop: { running: false } }, party);
  assert.equal(f.ui.hudParty.hidden, true);
});

test('crew summary preserves each weapon total and personal records preserve difficulty counts', () => {
  const f = fixture(), container = element();
  f.ui._renderCrewLoadout(container, { primary: 'machinegun', sidearm: 'mini-shotgun' }, {
    weapons: [{ id: 'machinegun', magazine: 70, reserve: 100, total: 170 }, { id: 'mini-shotgun', magazine: 1, reserve: 10, total: 11 }],
    oxygen: 2, medkits: 3, skill: 'barrier', passive: 'shield'
  });
  const text = container.children.map(line => line.children.map(child => child.textContent).join(' ')).join(' ');
  assert.match(text, /170/); assert.match(text, /11/); assert.doesNotMatch(text, /181/);
  assert.match(text, /磁锁隔离栅/); assert.match(text, /应急护盾/);
  f.ui.updatePersonalRecords({ easy: { success: 2, failure: 4 }, hard: { success: 7, failure: 1 } });
  assert.equal(f.get('[data-record="easy-success"]').textContent, '2');
  assert.equal(f.get('[data-record="easy-failure"]').textContent, '4');
  assert.equal(f.get('[data-record="medium-success"]').textContent, '0');
  assert.equal(f.get('[data-record="hard-success"]').textContent, '7');
});

test('Guest map chooser waits for host authority without building a local layout', () => {
  const f = fixture(); let constructs = 0;
  f.MapManager = class { constructor() { constructs++; } };
  f.menu.game = { state: { coop: { role: 'guest' } }, _ensureMenuMapSeeds: () => ({}), _previewDifficulty: () => 'medium', getMenuPreviewMap: () => null };
  f.menu.mapDialog = { open: true }; f.menu.mapDraft = { seeds: {}, scale: 'small' }; f.menu.mapDraftMaps = {}; f.menu.mapDraftErrors = {};
  const canvas = { ...element(), dataset: { mapPreview: 'small' } };
  f.document.querySelectorAll = selector => selector === '[data-map-preview]' ? [canvas] : [];
  assert.doesNotThrow(() => f.menu._refreshMapDialog());
  assert.equal(constructs, 0);
  assert.match(f.get('[data-map-preview-status="small"]').textContent, /同步/);
  assert.equal(f.get('#menuMapConfirm').disabled, true);
});

test('map incompatibility visibly prevents both readiness and start', () => {
  const f = fixture();
  const ui = new Proxy(f.ui, { get(target, key) { return key in target ? target[key] : key.startsWith('coop') ? f.get(`#${key}`) : undefined; } });
  ui.updateCoopLobby({ role: 'host', connected: true, mapIncompatible: true, members: [], hostLoadout: { sidearm: 'pistol' } });
  assert.equal(f.get('#coopReadyButton').disabled, true);
  assert.equal(f.get('#coopStartButton').disabled, true);
  assert.match(f.get('#coopStatus').textContent, /地图版本不一致/);
});

test('inventory consumables and specimen use unified art while flashbang retains its reference', () => {
  const f = fixture();
  assert.equal(f.Backpack.imageFor({ effect: 'health-40' }), 'resources/images/equipment-v17/medkit.png');
  assert.equal(f.Backpack.imageFor({ name: '异种样本' }), 'resources/images/equipment-v17/specimen.png');
  assert.equal(f.Backpack.imageFor({ effect: 'flashbang' }), 'resources/images/flashbang.png');
});

test('left HUD panels share a flow owner for short-height layouts', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const hud = html.slice(html.indexOf('<div class="hud-overlay"'), html.indexOf('<!-- QTE Terminal Interface Overlay -->'));
  const stack = [], panels = new Map();
  for (const tag of hud.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
    const [, closing, name, attributes] = tag;
    if (closing) { assert.equal(stack.pop()?.name, name); continue; }
    const node = { name, className: attributes.match(/class="([^"]*)"/)?.[1] || '', parent: stack.at(-1) };
    for (const panel of ['hud-vitals-cluster', 'hud-party', 'hud-equipment-status', 'hud-ammo']) {
      if (node.className.split(' ').includes(panel)) panels.set(panel, node);
    }
    if (!['img', 'br', 'input', 'hr', 'area', 'source'].includes(name)) stack.push(node);
  }
  assert.equal(stack.length, 0, 'HUD markup must close every non-void element');
  assert.equal(panels.size, 4);
  const owner = panels.get('hud-party').parent;
  assert.equal(owner.className, 'hud-left-column');
  for (const panel of panels.values()) assert.equal(panel.parent, owner);
});
