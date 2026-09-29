const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('title screen removes its three screen overlays while both scenes retain their artwork and lamps', () => {
  const prep = html.split('data-menu-motion="prep"')[1].split('<section id="titleScreen"')[0];
  const title = html.split('data-menu-motion="title"')[1].split('<div class="title-menu"')[0];
  assert.equal((title.match(/class="menu-motion-screen/g) || []).length, 0);
  assert.equal((prep.match(/class="menu-motion-screen/g) || []).length, 3);
  for (const [name, scene] of [['title', title], ['prep', prep]]) {
    assert.equal((scene.match(/class="menu-motion-lamp/g) || []).length, 4);
    for (const art of [`${name}-exterior-v1.png`, `${name}-cockpit-v1.png`, 'drifting-debris-v1.png']) {
      assert.ok(scene.includes(art), `${name} must retain ${art}`);
      assert.ok(fs.existsSync(path.join(root, 'resources/images/menu', art)));
    }
  }
});

test('Hunter quantities accept 200 while HP and interval limits keep their existing values', () => {
  const controls = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
  for (const setting of ['hunters', 'hunterRespawnCount', 'hunterMaxHp', 'hunterSpawnInterval']) {
    const matches = controls.filter(tag => tag.includes(`data-hunter-setting="${setting}"`));
    assert.equal(matches.length, 3);
    const max = setting === 'hunterMaxHp' ? 100 : setting === 'hunterSpawnInterval' ? 120 : 200;
    for (const tag of matches) assert.match(tag, new RegExp(`\\bmax="${max}"`), setting);
  }
  assert.match(controls.find(tag => tag.includes('id="finalTerminalSpawnCount"')), /\bmax="200"/);
  assert.match(controls.find(tag => tag.includes('id="finalTerminalSpawnInterval"')), /\bmax="120"/);
});

test('corpse performance select has three local display choices and defaults to 100', () => {
  const select = html.match(/<select id="corpseLimitSelect"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, 'performance settings must expose the local corpse display limit');
  assert.match(select[0], /aria-describedby="corpseLimitHelp"/);
  const options = [...select[1].matchAll(/<option value="(\d+)"([^>]*)>/g)];
  assert.deepEqual(options.map(option => Number(option[1])), [40, 100, 200]);
  assert.deepEqual(options.filter(option => /\bselected\b/.test(option[2])).map(option => Number(option[1])), [100]);
  assert.match(html, /<label for="corpseLimitSelect">/);
  assert.match(html, /<small id="corpseLimitHelp">[^<]*静态[^<]*淡出[^<]*本机/);
});

test('UI setting sync updates the existing corpse select and tolerates a missing control', () => {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { value: '', getContext: () => ({}) });
      return elements.get(selector);
    },
    querySelectorAll: () => []
  };
  const sandbox = { document, Config: { weapons: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8') + '\nglobalThis.UI = UIManager;', sandbox);
  const ui = new sandbox.UI();
  assert.equal(ui.corpseLimitSelect, elements.get('#corpseLimitSelect'));
  assert.equal(typeof ui.updateCorpseLimit, 'function');
  for (const limit of [40, 100, 200]) {
    ui.updateCorpseLimit(limit);
    assert.equal(String(ui.corpseLimitSelect.value), String(limit));
  }
  ui.corpseLimitSelect = null;
  assert.doesNotThrow(() => ui.updateCorpseLimit(100));
});

test('existing launch, menu and performance controls keep unique IDs and script resources remain valid', () => {
  for (const id of ['titleScreen', 'preparationScreen', 'enterPreparationButton', 'startButton', 'hunterSettingsModal', 'hunterSettingsClose', 'fpsCapSelect']) {
    assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, id);
  }
  for (const script of html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g)) {
    assert.ok(fs.existsSync(path.join(root, script[1])), `script resource ${script[1]} must exist`);
  }
});
