const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.textContent = '';
    this.classList = { add() {}, toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
}

const root = path.join(__dirname, '..');
const elements = new Map();
const sandbox = {
  window: { addEventListener() {} },
  document: {
    getElementById: id => elements.get(id),
    createElement: tagName => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName)
  }
};
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/config.js'), 'utf8')}\nglobalThis.ConfigUnderTest = Config;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8')}\nglobalThis.UIManagerUnderTest = UIManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/game.js'), 'utf8')}\nglobalThis.GameUnderTest = Game;`, sandbox);

test('currency artwork is a transparent PNG game resource', () => {
  const bytes = fs.readFileSync(path.join(root, 'resources', 'images', 'voidshift-credit-coin.png'));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes[25], 6, 'coin PNG should preserve its alpha channel');
});

test('credit values render the coin image and keep the numeric balance accessible', () => {
  const ui = Object.create(sandbox.UIManagerUnderTest.prototype);
  const target = new FakeElement('strong');

  ui.setCurrencyValue(target, 1234, { grouped: true });

  assert.equal(target.children.length, 2);
  assert.equal(target.children[0].tagName, 'img');
  assert.equal(target.children[0].attributes.class, 'credit-token-image');
  assert.equal(target.children[0].attributes.src, 'resources/images/voidshift-credit-coin.png');
  assert.equal(target.children[1].textContent, '1,234');
  assert.equal(target.attributes['aria-label'], '1,234 信用点');

  ui.setCurrencyValue(target, 42);
  assert.equal(target.children[1].textContent, '42');
  assert.equal(target.children.length, 2);
});

test('scale quota and ammo price updates retain their number while using the coin image', () => {
  const ui = Object.create(sandbox.UIManagerUnderTest.prototype);
  const quota = new FakeElement('strong');
  const purchaseCost = new FakeElement('span');
  const amount = new FakeElement('input');
  amount.value = '250';
  ui.currentScaleText = new FakeElement('strong');
  ui.quotaDisplay = quota;
  ui.scaleButtons = {};
  ui.ammoPurchaseAmount = amount;
  ui.ammoPurchaseCost = purchaseCost;
  ui.standardAmmoBalance = new FakeElement('span');
  ui.ammoPurchaseButton = null;
  ui.ammoTransferAmount = null;
  ui.ammoTransferButton = null;
  ui.ammoTransferSources = null;
  ui.ammoTransferTargets = null;
  ui.ammoStockGrid = null;

  ui.updateScaleButtons('small');
  ui.updateAmmoDepot({ standardAmmoUnits: 0, ownedWeapons: { pistol: true }, weaponAmmo: { pistol: { reserve: 120 } } });

  assert.equal(quota.children[1].textContent, '420');
  assert.equal(purchaseCost.children[1].textContent, '2,500');
  assert.equal(quota.children[0].tagName, 'img');
  assert.equal(purchaseCost.children[0].tagName, 'img');
  assert.equal(purchaseCost.children[0].attributes.src, 'resources/images/voidshift-credit-coin.png');
});

test('game balance refresh uses the currency renderer without altering the stored amount', () => {
  const game = Object.create(sandbox.GameUnderTest.prototype);
  const display = new FakeElement('strong');
  elements.set('moneyDisplay', display);
  game.state = { money: 5285 };
  game.ui = sandbox.UIManagerUnderTest.prototype;

  game.updateMoneyUI();

  assert.equal(display.children[1].textContent, '5285');
  assert.equal(game.state.money, 5285);
  elements.delete('moneyDisplay');
});
