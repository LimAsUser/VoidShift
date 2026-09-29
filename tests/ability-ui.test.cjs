const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function node() {
  const classes = new Set();
  return {
    children: [], dataset: {}, attributes: {}, listeners: {}, textContent: '', hidden: false,
    classList: {
      add(name) { classes.add(name); },
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return name === 'src' ? this.src : this.attributes[name]; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
}

function fixture() {
  const selectors = new Map();
  const get = selector => {
    if (!selectors.has(selector)) selectors.set(selector, node());
    return selectors.get(selector);
  };
  const calls = [];
  const tabs = ['weapons', 'skills', 'passives'].map(section => {
    const button = node(); button.dataset.loadoutSection = section; return button;
  });
  const sandbox = {
    window: { addEventListener() {}, game: {
      purchaseAbility(...args) { calls.push(['purchase', ...args]); },
      equipAbility(...args) { calls.push(['equip', ...args]); }
    } },
    document: {
      createElement: node,
      querySelector: get,
      getElementById: id => get(`#${id}`),
      querySelectorAll: selector => selector === '[data-loadout-section]' ? tabs : []
    }
  };
  vm.runInNewContext(fs.readFileSync('js/config.js', 'utf8') + '\nglobalThis.Config = Config;', sandbox);
  vm.runInNewContext(fs.readFileSync('js/ui.js', 'utf8') + '\nglobalThis.UI = UIManager;', sandbox);
  vm.runInNewContext(fs.readFileSync('js/menu.js', 'utf8') + '\nglobalThis.Menu = SafehouseMenu;', sandbox);
  sandbox.Config.skills = {
    flashbang: { id: 'flashbang', label: '闪光弹', price: 1000, cooldown: 15, image: 'resources/images/flashbang.png', description: '范围晕眩' },
    grenade: { id: 'grenade', label: '手榴弹', price: 5000, cooldown: 20, image: 'resources/images/abilities/grenade.png', description: '穿甲伤害 5' }
  };
  sandbox.Config.passives = {
    roll: { id: 'roll', label: '翻滚', price: 7000, image: 'resources/images/abilities/roll.png', description: 'Space 翻滚' },
    'life-scan': { id: 'life-scan', label: '生命扫描', price: 4000, image: 'resources/images/abilities/life-scan.png', description: '显示存活敌人' }
  };
  const ui = Object.create(sandbox.UI.prototype);
  ui.abilityCards = { skill: {}, passive: {} };
  ui.abilityCatalogs = { skill: node(), passive: node() };
  ui.loadoutLockNote = node();
  ui.hudSkillImage = node(); ui.hudSkillName = node(); ui.hudSkillStatus = node();
  const player = { armory: { ownedSkills: {}, ownedPassives: {}, equippedSkill: null, equippedPassive: null,
    loadout: { primary: null, sidearm: 'pistol' } }, skillReadyAt: 0 };
  const state = { money: 1000, running: false, transitioning: false, coop: { running: false }, elapsed: 0 };
  return { ...sandbox, ui, player, state, calls, get, tabs };
}

test('ability cards follow configuration and buying never dispatches an equip action', () => {
  const f = fixture();
  f.Config.skills.future = { id: 'future', label: '额外技能', price: 600, cooldown: 8, image: 'future.png', description: '配置扩展' };
  f.ui.updateAbilities(f.player, f.state);
  assert.equal(f.ui.abilityCatalogs.skill.children.length, 3);
  assert.equal(f.ui.abilityCatalogs.passive.children.length, 2);
  const flash = f.ui.abilityCards.skill.flashbang;
  assert.equal(flash.status.textContent, '未解锁');
  assert.equal(flash.purchase.disabled, false);
  assert.equal(flash.equip.hidden, true);
  assert.equal(f.ui.abilityCards.skill.grenade.purchase.disabled, true);
  flash.purchase.listeners.click();
  assert.deepEqual(f.calls, [['purchase', 'skill', 'flashbang']]);
  assert.equal(f.player.armory.equippedSkill, null);
  f.player.armory.ownedSkills.flashbang = true;
  f.ui.updateAbilities(f.player, f.state);
  assert.equal(f.ui.abilityCatalogs.skill.children.length, 3, 'refresh does not duplicate cards');
  assert.equal(flash.purchase.hidden, true);
  assert.equal(flash.equip.hidden, false);
  assert.equal(flash.status.textContent, '已拥有');
  flash.equip.listeners.click();
  assert.deepEqual(f.calls[1], ['equip', 'skill', 'flashbang']);
});

test('equipped summaries and controls distinguish selection from ownership and lock during a dive', () => {
  const f = fixture();
  f.player.armory.ownedSkills.flashbang = true;
  f.player.armory.ownedPassives.roll = true;
  f.player.armory.equippedSkill = 'flashbang';
  f.player.armory.equippedPassive = 'roll';
  f.ui.updateAbilities(f.player, f.state);
  assert.equal(f.ui.abilityCards.skill.flashbang.status.textContent, '已装备');
  assert.equal(f.ui.abilityCards.skill.flashbang.equip.disabled, true);
  assert.equal(f.get('[data-equipped-name="skill"]').textContent, '闪光弹');
  assert.equal(f.get('[data-equipped-image="passive"]').src, f.Config.passives.roll.image);
  assert.equal(f.get('[data-unequip-ability="passive"]').disabled, false);
  for (const lock of ['running', 'transitioning', 'coop']) {
    f.state.running = lock === 'running'; f.state.transitioning = lock === 'transitioning'; f.state.coop.running = lock === 'coop';
    f.ui.updateAbilities(f.player, f.state);
    assert.equal(f.ui.abilityCards.skill.grenade.purchase.disabled, true);
    assert.equal(f.get('[data-unequip-ability="skill"]').disabled, true);
    assert.match(f.ui.loadoutLockNote.textContent, /锁定/);
  }
});

test('skill HUD shows the selected cooldown using mission time and supports an empty slot', () => {
  const f = fixture();
  f.ui.updateSkillReadout(f.player, f.state);
  assert.equal(f.ui.hudSkillName.textContent, '主动技能未装备');
  assert.equal(f.ui.hudSkillImage.hidden, true);
  f.player.armory.equippedSkill = 'grenade';
  f.player.skillReadyAt = 25; f.state.elapsed = 6.3;
  f.ui.updateSkillReadout(f.player, f.state);
  assert.equal(f.ui.hudSkillName.textContent, '手榴弹');
  assert.equal(f.ui.hudSkillStatus.textContent, '19s');
  assert.equal(f.ui.hudSkillStatus.classList.contains('cooling-down'), true);
  f.state.elapsed = 25;
  f.ui.updateSkillReadout(f.player, f.state);
  assert.equal(f.ui.hudSkillStatus.textContent, '就绪');
});

test('Loadout sub-tabs change panels without replacing catalog or equipped-summary state', () => {
  const f = fixture(); const menu = Object.create(f.Menu.prototype);
  assert.equal(menu.selectLoadoutSection('skills'), true);
  assert.equal(f.get('#loadoutSectionWeapons').hidden, true);
  assert.equal(f.get('#loadoutSectionSkills').hidden, false);
  assert.equal(f.tabs[1].attributes['aria-selected'], 'true');
  assert.equal(menu.selectLoadoutSection('unknown'), false);
  assert.equal(menu.loadoutSection, 'skills');
});

test('full-map exploration excludes corridor rooms', () => {
  const f = fixture();
  f.ui.fullMapModal = node(); f.ui.fullMapExploreTag = node();
  const rooms = [{ discovered: true }, { discovered: false }];
  f.ui.updateFullMapStats({ functionalRooms: rooms, worldRooms: [...rooms, { discovered: true }], terminals: [] }, {});
  assert.equal(f.ui.fullMapExploreTag.textContent, '探索度: 1/2 (50%)');
});

test('map preview facts count functional rooms and actual terminals', () => {
  const f = fixture(); const menu = Object.create(f.Menu.prototype);
  const scales = ['small', 'medium', 'large'];
  const facts = Object.fromEntries(scales.map(scale => [scale, { children: [node(), node()] }]));
  f.document.querySelector = selector => facts[selector.match(/data-draft-scale="(\w+)"/)?.[1]];
  f.document.querySelectorAll = selector => selector === '[data-map-preview]'
    ? scales.map(scale => ({ dataset: { mapPreview: scale } })) : [];
  menu.game = { state: { coop: {} } };
  menu.mapDialog = { open: true };
  menu.mapDraft = { scale: 'small', seeds: { small: 1, medium: 2, large: 3 } };
  menu.mapDraftMaps = Object.fromEntries(scales.map((scale, index) => [scale, {
    seed: index + 1, functionalRooms: Array(16 + index * 10), worldRooms: Array(40 + index * 10), terminals: Array(3 + index)
  }]));
  menu.renderEnemyTypes = menu.setMapPreviewStatus = menu.updateMapPreviewControls = menu.queueMapPreviewPaint = () => {};
  menu._refreshMapDialog();
  scales.forEach((scale, index) => {
    assert.equal(facts[scale].children[0].textContent, `${16 + index * 10} 舱`);
    assert.equal(facts[scale].children[1].textContent, `${3 + index} 个终端`);
  });
});

test('markup removes consumable flashbang controls and preserves accessible equipment actions', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('menu.css', 'utf8');
  assert.doesNotMatch(html, /id="(?:hudFlashbangCount|shopFlashbangCount|loadoutFlashbangCount|purchaseFlashbangButton)"/);
  assert.doesNotMatch(html, /flashbang-shop|flashbang-loadout|购买手榴弹/);
  assert.match(html, /id="hudSkillStatus"/);
  assert.match(html, /100 单位 200 信用点/);
  for (const name of ['weapons', 'skills', 'passives']) assert.match(html, new RegExp(`data-loadout-section="${name}"`));
  assert.match(html, /data-unequip-ability="skill"/);
  assert.match(html, /data-unequip-ability="passive"/);
  assert.match(css, /\.loadout-catalog-scroll\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.loadout-equipment-summary\s*\{[^}]*max-height:\s*40%/);
});
