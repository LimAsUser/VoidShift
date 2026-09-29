const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('safehouse keeps storage, next-dive backpack and oxygen supply inside existing pages', () => {
  assert.match(html, /id="storageGrid"/);
  assert.match(html, /id="prepBackpackGrid"/);
  assert.doesNotMatch(html, /id="moveSelectedStorageToPackButton"/);
  assert.doesNotMatch(html, /id="moveSelectedPackToStorageButton"/);
  assert.match(html, /id="menuDetailDialog"/);
  assert.match(html, /id="purchaseOxygenCanisterButton"/);
  const oxygenArt = html.match(/<img class="consumable-shop-art" src="([^"]+)"/);
  assert.ok(oxygenArt && fs.existsSync(path.join(root, oxygenArt[1])), 'The oxygen shop must display a real local image');
});

test('field inventory exposes a selected-item use action and the map fog controls are gone', () => {
  assert.match(html, /id="useItemBtn"/);
  assert.match(html, /id="inventoryEquipmentBar"/);
  assert.match(html, /id="prepEquipmentBar"/);
  assert.match(html, /id="inventoryXAxis"/);
  assert.doesNotMatch(html, /id="(?:testRevealBtn|hudRevealBtn|fullMapFogToggleBtn)"/);
});

test('briefing owns the crew lobby and sole dive action without a separate CO-OP tab or footer', () => {
  assert.match(html, /data-tab="briefing"[^>]*>任务\s*\/\s*小队/);
  assert.doesNotMatch(html, /data-tab="coop"/);
  assert.doesNotMatch(html, /id="coopContent"/);
  assert.doesNotMatch(html, /class="safehouse-footer"/);
  assert.equal((html.match(/id="startButton"/g) || []).length, 1);
  assert.match(html, /id="briefingContent"[\s\S]*id="coopLobby"[\s\S]*id="startButton"/);
});

test('ammo depot has three single-panel section selectors', () => {
  for (const section of ['purchase', 'transfer', 'oxygen']) {
    assert.match(html, new RegExp(`data-ammo-section="${section}"`));
  }
  assert.match(html, /id="ammoSectionPurchase"/);
  assert.match(html, /id="ammoSectionTransfer"/);
  assert.match(html, /id="ammoSectionOxygen"/);
});

test('title screen keeps start and a bottom-right settings icon without its old subtitle', () => {
  const title = html.split('id="titleScreen"')[1].split('id="preparationScreen"')[0];
  assert.doesNotMatch(title, /进入任务准备/);
  assert.match(title, /class="title-settings-icon"/);
});

test('in-mission Esc menu exposes continue, settings and confirmed abandon actions', () => {
  for (const id of ['pauseMenuDialog','pauseResumeButton','pauseSettingsButton','pauseAbandonButton','abandonConfirmDialog','abandonConfirmButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('map and backpack overlays animate and honor reduced motion', () => {
  assert.match(css, /\.full-map-modal\.closing/);
  assert.match(css, /#inventoryOverlay\.inventory-overlay\.is-open/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
