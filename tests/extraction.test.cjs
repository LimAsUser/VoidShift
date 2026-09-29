const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = { window: { addEventListener() {} }, performance: { now: () => 1000 }, Image:class { constructor(){this.complete=false;this.naturalWidth=0;} } };
for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/inventory.js', 'globalThis.BackpackManagerUnderTest = BackpackManager;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', file), 'utf8')}\n${exportCode}`, sandbox);
const Game = sandbox.GameUnderTest;
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js/renderer.js'), 'utf8')}\nglobalThis.RendererUnderTest = Renderer;`, sandbox);
const Renderer = sandbox.RendererUnderTest;

function makeGame() {
  const game = Object.create(Game.prototype);
  game.state = { running: true, selectedDifficulty:'medium', extractionCalled: false, rescueRemaining: 0, rescueArrived: false,
    coop: { role: null, running: false, hostPaused: false }, tutorial: null };
  game.player = { x: 100, y: 100, dodgeTimer: 0, downed: false, health: 100, oxygen: 100 };
  game.map = { extractionPoint: { x: 100, y: 100 }, exitExtractionPoint: { x: 500, y: 500 }, terminals: [{ solved: true }] };
  game.ui = { showToast() {}, log() {}, updateExtractionCalledState() {}, updateExtractionProgress() {} };
  game.audio = { playTone() {} };
  game.activateMonster = () => {};
  game._tutorialAction = () => {};
  game.finish = success => { game.finished = success; game.state.running = false; };
  return game;
}

test('only E at the far evac pod can start the medium forty-second rescue', () => {
  const game = makeGame();
  assert.equal(game.callExtraction(game.player), false);
  assert.equal(game.state.extractionCalled, false);
  const guest = { x: 500, y: 500, dodgeTimer: 0, downed: false };
  assert.equal(game.callExtraction(guest), true);
  assert.equal(game.state.extractionCalled, true);
  assert.equal(game.state.rescueRemaining, 40);
  assert.equal(game.state.rescueArrived, false);
});

test('host accepts a guest E interaction at the far pod using that guest position', () => {
  const game = makeGame();
  game.state.coop = { role: 'host', running: true, hostPaused: false };
  game.map.scrap = [];
  game.map.doors = [];
  game.map.windows = [];
  const guest = { x: 500, y: 500, dodgeTimer: 0, stunned: 0, downed: false };
  const entry = { id: 'guest', online: true, player: guest };
  game.remotePlayers = new Map([['guest', entry]]);
  game._remoteEntryForActor = actor => actor === guest ? entry : null;
  game._coopRosterEntries = () => [{ id: 'host', online: true, player: game.player }, entry];
  game._handleRemoteAction({ action: 'interact' }, 'guest');
  assert.equal(game.state.extractionCalled, true);
  assert.equal(game.state.rescueRequired, 2);
});

test('rescue cannot finish before forty seconds and then waits for every online player', () => {
  const game = makeGame();
  game.state.coop = { role: 'host', running: true };
  game.state.extractionCalled = true;
  game.state.rescueRemaining = 40;
  game.player.x = game.player.y = 500;
  const downed = { x: 580, y: 500, downed: true };
  game._coopRosterEntries = () => [
    { id: 'host', online: true, player: game.player },
    { id: 'guest', online: true, player: downed }
  ];
  assert.equal(game._advanceExtraction(39.9), false);
  assert.equal(game.finished, undefined);
  assert.equal(game._advanceExtraction(0.2), false);
  assert.equal(game.state.rescueArrived, true);
  downed.x = 520;
  assert.equal(game._advanceExtraction(0.1), true);
  assert.equal(game.finished, true);
});

test('offline seat blocks rescue until removed and all-downed still fails', () => {
  const game = makeGame();
  game.state.coop = { role: 'host', running: true };
  game.state.extractionCalled = true;
  game.state.rescueRemaining = 0;
  game.state.rescueArrived = true;
  game.player.x = game.player.y = 500;
  const offline = { id: 'guest', online: false, player: { x: 500, y: 500, downed: false } };
  const roster = [{ id: 'host', online: true, player: game.player }, offline];
  game._coopRosterEntries = () => roster;
  assert.equal(game._advanceExtraction(0.1), false);
  roster.pop();
  game.player.downed = true;
  assert.equal(game._advanceExtraction(0.1), false);
  game.player.downed = false;
  assert.equal(game._advanceExtraction(0.1), true);
});

test('completed terminals mark an undiscovered far evac pod without revealing its room label', () => {
  const texts = [];
  const ctx = Object.fromEntries(['clearRect','fillRect','beginPath','moveTo','lineTo','closePath','fill','stroke',
    'save','restore','translate','scale','arc','rotate','strokeRect'].map(name => [name, () => {}]));
  ctx.fillText = text => texts.push(String(text));
  const renderer = new Renderer({ fullMapCanvas: { width: 400, height: 300 }, fullMapCtx: ctx, updateFullMapStats() {} });
  const start = { x: 0, y: 0, w: 200, h: 200, center: { x: 100, y: 100 }, discovered: true, type: 'airlock', label: 'START' };
  const evac = { x: 500, y: 500, w: 200, h: 200, center: { x: 600, y: 600 }, discovered: false, type: 'evacpod', label: 'SECRET' };
  const map = { worldRooms: [start, evac], walls: [], doors: [], scrap: [], terminals: [{ x: 150, y: 150, room: start, solved: false }],
    extractionPoint: { x: 100, y: 100 }, exitExtractionPoint: { x: 600, y: 600 },
    getRoomAt: (x, y) => x > 400 && y > 400 ? evac : start };
  renderer.drawFullMap({ x: 100, y: 100, angle: 0 }, map, { revealAllMap: false });
  assert.equal(texts.some(text => text.includes('撤离点')), false);
  texts.length = 0;
  map.terminals[0].solved = true;
  renderer.drawFullMap({ x: 100, y: 100, angle: 0 }, map, { revealAllMap: false });
  assert.equal(texts.some(text => text.includes('撤离点')), true);
  assert.equal(texts.some(text => text.includes('SECRET')), false);
});
