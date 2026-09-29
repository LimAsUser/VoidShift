const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'js/menu.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'js/renderer.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const menuCss = fs.readFileSync(path.join(root, 'menu.css'), 'utf8');

test('compact four-row map cards apply only to mobile, not desktop', () => {
  const css = menuCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      stack.push({ selector: css.slice(start, i).trim(), body: i + 1 });
      start = i + 1;
    } else if (css[i] === '}') {
      const rule = stack.pop();
      const declarations = css.slice(rule.body, i);
      if (rule.selector === '#preparationScreen .menu-map-dialog .map-scale-card' &&
          /grid-template-rows: auto minmax\(130px,auto\)/.test(declarations)) {
        assert.ok(stack.some(parent => /@media.*max-width:\s*700px/.test(parent.selector)),
          'mobile row allocation must not override the six desktop card rows');
      }
      start = i + 1;
    }
  }
});

test('confirmed enemy roster lives under the lobby map, not only in the left briefing', () => {
  const mapPanel = html.match(/<div class="coop-map-summary">[\s\S]*?<\/canvas>[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(mapPanel, /id="briefEnemyTypes"/);
  assert.equal([...html.matchAll(/id="briefEnemyTypes"/g)].length, 1);
});

test('active skills replace physical flashbang sales and inventory readouts', () => {
  for (const id of ['skillCatalog', 'passiveCatalog', 'hudSkillName', 'hudSkillStatus', 'hudFlashStun']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="(?:purchaseFlashbangButton|shopFlashbangCount|loadoutFlashbangCount|hudFlashbangCount)"/);
  assert.doesNotMatch(menu, /game\.buyFlashbang\(\)/);
  assert.match(ui, /updateAbilities\(player, state\)/);
  assert.match(ui, /updateSkillReadout\(player, state\)/);
  assert.match(html, /<b class="key">T<\/b> 主动技能/);
  assert.match(html, /<b class="key">F<\/b> 手电筒/);
});

test('seeded preview renders each species and matching room loot', () => {
  const sandbox = {
    window: { addEventListener() {} },
    document: { createElement(tagName) {
      return { tagName, children: [], append(...children) { this.children.push(...children); } };
    } }
  };
  vm.runInNewContext(`${menu}\nglobalThis.SafehouseMenu = SafehouseMenu;`, sandbox);
  const container = { replaceChildren(...children) { this.children = children; } };
  sandbox.SafehouseMenu.prototype.renderEnemyTypes(container, { enemyTypes: ['monster', 'heavy'] });
  assert.equal(container.children[0].textContent, '每舱物资 2 件 · 本局敌人');
  assert.deepEqual(Array.from(container.children.slice(1), row => row.children[1].textContent), ['Monster', 'Heavy']);
  assert.equal(container.children[1].children[0].src, 'resources/images/monster-topdown.png');
  assert.equal(container.children[2].children[0].src, 'resources/images/heavy-topdown.png');
});

test('hazard geometry stops at swept-body blockers and first blast wall', () => {
  const sandbox = { Config: { flashbang: { blastRadius: 80 } } };
  vm.runInNewContext(`${rendererSource}\nglobalThis.Renderer = Renderer;`, sandbox);
  const renderer = new sandbox.Renderer({});
  const map = {
    rayWallDistance() { return 100; },
    blocked(x, y, radius) { return radius === 22 && x >= 40; }
  };
  assert.ok(renderer.heavyChargeDistance({ x: 0, y: 0, chargeAngle: 0 }, map) < 40);
  assert.equal(renderer.flashBurstDistance({ x: 0, y: 0 }, map, 0), 80);
  map.rayWallDistance = () => 24;
  assert.equal(renderer.flashBurstDistance({ x: 0, y: 0 }, map, 0), 24);
});

test('Heavy telegraph reaches a distant first wall beyond 500 units', () => {
  const sandbox = {};
  vm.runInNewContext(`${rendererSource}\nglobalThis.Renderer = Renderer;`, sandbox);
  const renderer = new sandbox.Renderer({});
  const map = {
    worldW: 900, worldH: 600,
    rayWallDistance(x, y, dx, dy, limit) { return Math.min(limit, 800); },
    blocked() { return false; }
  };
  assert.equal(renderer.heavyChargeDistance({ x: 0, y: 0, chargeAngle: 0, radius: 22 }, map), 778);
});

test('active skill HUD follows equipped ability and mission cooldown instead of inventory stock', () => {
  const sandbox = { Config: { skills: {
    flashbang: { label: '闪光弹', image: 'resources/images/flashbang.png' },
    grenade: { label: '手榴弹', image: 'resources/images/abilities/grenade.png' }
  } } };
  vm.runInNewContext(`${ui}\nglobalThis.UIManager = UIManager;`, sandbox);
  const manager = Object.create(sandbox.UIManager.prototype);
  manager.hudSkillName = { textContent: '' };
  manager.hudSkillStatus = { textContent: '', classList: { toggle() {} } };
  manager.hudSkillImage = { hidden: false, getAttribute() { return this.src; } };
  const player = { armory: { equippedSkill: null }, skillReadyAt: 0 };
  manager.updateSkillReadout(player, { elapsed: 0 });
  assert.equal(manager.hudSkillName.textContent, '主动技能未装备');
  assert.equal(manager.hudSkillImage.hidden, true);
  player.armory.equippedSkill = 'flashbang'; player.skillReadyAt = 15;
  manager.updateSkillReadout(player, { elapsed: 0 });
  assert.equal(manager.hudSkillName.textContent, '闪光弹');
  assert.equal(manager.hudSkillStatus.textContent, '15s');
  manager.updateSkillReadout(player, { elapsed: 15 });
  assert.equal(manager.hudSkillStatus.textContent, '就绪');
  player.armory.equippedSkill = 'grenade'; player.skillReadyAt = 35;
  manager.updateSkillReadout(player, { elapsed: 15 });
  assert.equal(manager.hudSkillName.textContent, '手榴弹');
  assert.equal(manager.hudSkillStatus.textContent, '20s');
  assert.equal(manager.hudSkillImage.src, 'resources/images/abilities/grenade.png');
});

test('door closes with two half-length sliding leaves', () => {
  const sandbox = {};
  vm.runInNewContext(`${rendererSource}\nglobalThis.Renderer = Renderer;`, sandbox);
  const strokes = [];
  let start;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, rect() {}, clip() {}, translate() {}, rotate() {},
    moveTo(x, y) { start = { x, y }; },
    lineTo(x, y) { strokes.push({ start, end: { x, y } }); },
    stroke() {}, fillRect() {}, strokeRect() {}
  };
  const renderer = new sandbox.Renderer({});
  renderer.drawDoors(ctx, { doors: [{ p1: { x: 0, y: 0 }, p2: { x: 128, y: 0 }, animationProgress: 0 }] });
  assert.ok(strokes.some(s => s.start.x === 0 && s.end.x === 64));
  assert.ok(strokes.some(s => s.start.x === 128 && s.end.x === 64));
});
