const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeDomElement(tagName = 'span') {
  return {
    tagName,
    textContent: '',
    children: [],
    attributes: {},
    classList: { add() {}, toggle() {} },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; }
  };
}

const root = path.join(__dirname, '..');
const timers = new Map();
const clearedTimers = [];
let nextTimerId = 1;
let animationFrames = 0;
const sandbox = {
  window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
  document: {
    body: { classList: { add() {}, remove() {} } },
    getElementById: () => null,
    createElement: tagName => makeDomElement(tagName),
    createElementNS: (_namespace, tagName) => makeDomElement(tagName)
  },
  performance: { now: () => 1000 },
  requestAnimationFrame: () => { animationFrames++; },
  setTimeout: (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout: id => { clearedTimers.push(id); timers.delete(id); },
  Event
};

for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/audio.js', 'globalThis.AudioManagerUnderTest = AudioManager;'],
  ['js/ui.js', 'globalThis.UIManagerUnderTest = UIManager;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(root, file), 'utf8')}\n${exportCode}`, sandbox);
}

const Config = sandbox.ConfigUnderTest;
const AudioManager = sandbox.AudioManagerUnderTest;
const UIManager = sandbox.UIManagerUnderTest;
const Player = sandbox.PlayerUnderTest;
const Game = sandbox.GameUnderTest;

function makeGame() {
  const uiEvents = [];
  const game = Object.create(Game.prototype);
  game.state = {
    running: false,
    transitioning: false,
    completed: false,
    coop: { running: false, role: null },
    armory: Player.createDefaultArmory(),
    selectedDifficulty: 'medium',
    keys: {},
    loot: 0,
    lootValue: 0,
    elapsed: 0,
    inventory: [],
    remoteInventory: [],
    storageItems: [],
    bulletTraces: [],
    muzzleFlashes: [],
    impactParticles: [],
    fireHeld: false
  };
  game.player = { armory: game.state.armory, reloading: 0, oxygen: 100, health: 100, stamina: 100, noise: 0 };
  game.monster = { active: false, alerted: false };
  game.hunters = [];
  game.map = { terminals: [] };
  game.audio = {
    ensureAudio() {}, beginMissionAudio() { uiEvents.push('audio-start'); },
    stopMissionAudio() { uiEvents.push('audio-stop'); }
  };
  game.renderer = { prepareCamera() {} };
  game.ui = {
    showDescentTransition() { uiEvents.push('transition-show'); },
    hideDescentTransition() { uiEvents.push('transition-hide'); },
    hideTutorial() {}, hideQTE() {}, updateStartState() {}, updateTerminalsStatus() {},
    updateFinishState(success, summary) { uiEvents.push(['settlement', success, summary]); },
    updateTerminalsStatus() {}, update() {}, updateStorageUI() {},
    updateDifficultyPreset() {}, updateHunterSettings() {}, updateLoadout() {}
  };
  game.uiEvents = uiEvents;
  game.updateDifficultyUI = () => {};
  game.updateHunterSettingsUI = () => {};
  game.updateLoadoutUI = () => {};
  game.updateTutorialAvailability = () => {};
  game.updateCoopUI = () => {};
  game.updateStorageUI = () => {};
  game._save = () => {};
  game.handleResize = () => {};
  game.render = () => {};
  return game;
}

test('dive waits behind the transition, and Space skip begins gameplay only once', () => {
  animationFrames = 0;
  timers.clear();
  const game = makeGame();

  game.start();

  assert.equal(game.state.transitioning, true);
  assert.equal(game.state.running, false);
  assert.equal(animationFrames, 0);
  assert.ok(game.uiEvents.includes('transition-show'));

  assert.equal(game.skipDescentTransition(), true);
  assert.equal(game.state.transitioning, false);
  assert.equal(game.state.running, true);
  assert.equal(animationFrames, 1);
  assert.equal(game.skipDescentTransition(), false);
  assert.equal(animationFrames, 1);
});

test('the descent timer begins gameplay automatically after its transition', () => {
  animationFrames = 0;
  timers.clear();
  const game = makeGame();

  game.start();
  const timer = Array.from(timers.values())[0];
  assert.equal(timer.delay, 1200);
  timer.callback();

  assert.equal(game.state.transitioning, false);
  assert.equal(game.state.running, true);
  assert.equal(animationFrames, 1);
  timer.callback();
  assert.equal(animationFrames, 1);
});

test('reduced motion bypasses the animated descent', () => {
  animationFrames = 0;
  timers.clear();
  const game = makeGame();
  sandbox.window.matchMedia = () => ({ matches: true });

  game.start();

  assert.equal(game.state.transitioning, false);
  assert.equal(game.state.running, true);
  assert.equal(animationFrames, 1);
  assert.equal(timers.size, 0);
  assert.ok(game.uiEvents.includes('audio-start'));
  sandbox.window.matchMedia = () => ({ matches: false });
});

test('settlement summary preserves mission count, value, time, and the applicable ammo result', () => {
  const game = makeGame();
  Object.assign(game.state, { loot: 3, lootValue: 420, elapsed: 512, selectedDifficulty: 'hard' });

  const failed = game.buildSettlementSummary(false);
  const success = game.buildSettlementSummary(true);

  assert.deepEqual(
    [failed.success, failed.lootCount, failed.lootValue, failed.elapsedSeconds],
    [false, 3, 420, 512]
  );
  assert.match(failed.ammoOutcome, /全部损失/);
  assert.equal(success.ammoOutcome, '成功撤离：携带弹药全部保留。');
});

test('the settlement dialog renders both outcome states with mission and ammo details', () => {
  const ui = Object.create(UIManager.prototype);
  const makeText = () => makeDomElement();
  ui.settlementDialog = { open: false, classList: { toggle() {} }, showModal() { this.open = true; } };
  ui.settlementEyebrow = makeText();
  ui.settlementTitle = makeText();
  ui.settlementSubtitle = makeText();
  ui.settlementDifficulty = makeText();
  ui.settlementLootLabel = makeText();
  ui.settlementLootCount = makeText();
  ui.settlementValueLabel = makeText();
  ui.settlementLootValue = makeText();
  ui.settlementDuration = makeText();
  ui.settlementAmmoOutcome = makeText();

  ui.showSettlement({ success: true, coop: false, difficulty: 'medium', lootCount: 3, lootValue: 420, elapsedSeconds: 512, ammoOutcome: '撤离成功：携带弹药全部保留。' });
  assert.equal(ui.settlementTitle.textContent, '任务完成');
  assert.equal(ui.settlementLootCount.textContent, '3 件');
  assert.equal(ui.settlementLootValue.children[0].tagName, 'img');
  assert.equal(ui.settlementLootValue.children[0].attributes.src, 'resources/images/voidshift-credit-coin.png');
  assert.equal(ui.settlementLootValue.children[1].textContent, '420');
  assert.equal(ui.settlementLootValue.attributes['aria-label'], '420 信用点');
  assert.equal(ui.settlementDuration.textContent, '08:32');
  assert.match(ui.settlementAmmoOutcome.textContent, /全部保留/);

  ui.showSettlement({ success: false, coop: true, difficulty: 'hard', lootCount: 2, lootValue: 160, elapsedSeconds: 65, ammoOutcome: '困难难度：弹药全部损失。' });
  assert.equal(ui.settlementTitle.textContent, '任务失败');
  assert.equal(ui.settlementSubtitle.textContent, '小队通讯中断，本次下潜已结束。');
  assert.equal(ui.settlementDuration.textContent, '01:05');
  assert.match(ui.settlementAmmoOutcome.textContent, /全部损失/);
});

test('finishing stops audio and clears active threats and combat effects before showing settlement', () => {
  const game = makeGame();
  game.state.running = true;
  game.state.inventory = [{ value: 420 }];
  game.state.loot = 1;
  game.state.lootValue = 420;
  game.state.elapsed = 33;
  game.state.selectedDifficulty = 'easy';
  game.state.bulletTraces = [{}];
  game.state.impactParticles = [{}];
  game.monster.active = true;
  game.hunters = [
    { active: true, dead: true, deathFade: 0.8, revivePending: true },
    { active: true, dead: false, deathFade: 0, revivePending: false }
  ];
  game.player.armory = { exportArmory() { return {}; } };
  sandbox.document.getElementById = () => null;

  game.finish(false);

  assert.equal(game.state.running, false);
  assert.equal(game.monster.active, false);
  assert.deepEqual(game.hunters.map(hunter => [hunter.active, hunter.dead, hunter.deathFade, hunter.revivePending]), [
    [false, false, 0, false],
    [false, false, 0, false]
  ]);
  assert.equal(game.state.bulletTraces.length, 0);
  assert.equal(game.state.impactParticles.length, 0);
  assert.ok(game.uiEvents.includes('audio-stop'));
  const settlement = game.uiEvents.find(event => Array.isArray(event) && event[0] === 'settlement');
  assert.equal(settlement[1], false);
  assert.equal(settlement[2].lootCount, 1);
  assert.equal(settlement[2].lootValue, 420);
});

test('a QTE timeout that ends the mission stops the same update before world and audio processing', () => {
  const game = makeGame();
  let roomQueries = 0;
  let audioUpdates = 0;
  game.state.running = true;
  game.state.coop.running = false;
  game.state.activeQte = { timeLeft: 0.01, maxTime: 10 };
  game.state.qteMonsterTpCooldown = 0;
  game.state.fullMapOpen = false;
  game.state.inventoryOpen = false;
  game.state.stabilized = false;
  game.player = {
    x: 20, y: 20, stunned: 0, dodgeTimer: 0, moveSpeed: 0, noise: 0,
    health: 100, oxygen: 100, update: () => ({})
  };
  game.map.getRoomAt = () => { roomQueries++; return { discovered: true }; };
  game._tutorialAction = () => {};
  game._updateRemotePlayer = () => {};
  game._lockFinalTerminalNoise = () => {};
  game._checkCoopDisconnect = () => false;
  game.handleQTETimeout = () => { game.state.running = false; };
  game.ui.updateQTETimer = () => {};
  game.monster = { active: false, update() {} };
  game.audio.update = () => { audioUpdates++; };

  game.update(0.02);

  assert.equal(game.state.running, false);
  assert.equal(roomQueries, 0);
  assert.equal(audioUpdates, 0);
});

test('a delayed QTE error animation cannot redraw an older terminal over a newer QTE', () => {
  timers.clear();
  const game = makeGame();
  const oldTerminal = { id: 'old-terminal', sequence: ['w', 'a', 's', 'd', 'w'] };
  const newTerminal = { id: 'new-terminal', sequence: ['d', 's', 'a', 'w', 'd'] };
  const qteDraws = [];
  game.state.activeQte = {
    terminal: oldTerminal, sequence: ['w', 'a', 's', 'd', 'w'], currentIndex: 0, failCount: 0, maxFails: 3
  };
  game.player = { noise: 0 };
  game.audio = { playQTEErrorBeep() {} };
  game.map.generateQTESequence = () => ['w', 'a', 's', 'd', 'w'];
  game.ui = { triggerDamageFlash() {}, showToast() {}, log() {}, showQTE: (...args) => qteDraws.push(args) };
  game.teleportMonsterToNearbyRoom = () => {};

  game.handleQTEInput('a');
  assert.equal(qteDraws.length, 1);
  game.state.activeQte = {
    terminal: newTerminal, sequence: ['d', 's', 'a', 'w', 'd'], currentIndex: 0, failCount: 0, maxFails: 3
  };
  const delayedAnimation = Array.from(timers.values())[0].callback;
  delayedAnimation();

  assert.equal(qteDraws.length, 1);
  assert.equal(qteDraws[0][0], oldTerminal);
  assert.equal(qteDraws[0][2], true);
});

test('audio shutdown stops active/ambient sources, cancels delayed cues, and can resume on the next dive', () => {
  const audio = Object.create(AudioManager.prototype);
  const stopCounts = [];
  const active = { stop() { stopCounts.push('sfx'); } };
  const ambient = { stop() { stopCounts.push('ambient'); } };
  const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } });
  audio.context = { currentTime: 0 };
  audio.master = { gain: param() };
  audio.proximityGain = { gain: param() };
  audio.activeSources = new Set([active, ambient]);
  audio.scheduledAudioTimers = new Set([901]);
  audio.soundBuffers = new Map();
  audio.soundLoads = new Map();
  audio.ambientSource = ambient;
  audio.audioGeneration = 2;
  audio.missionAudioMuted = false;
  audio.ensureAudio = () => {};
  audio.playAmbientNoiseLoop = () => { audio.ambientSource = { stop() {} }; };
  let delayedCuePlayed = false;
  const scheduled = audio._scheduleAudio(() => { delayedCuePlayed = true; }, 180);
  const lateCallback = timers.get(scheduled).callback;

  audio.stopMissionAudio();

  assert.deepEqual(stopCounts.sort(), ['ambient', 'sfx']);
  assert.equal(audio.missionAudioMuted, true);
  assert.equal(audio.master.gain.value, 0);
  assert.equal(audio.proximityGain.gain.value, 0);
  assert.equal(audio.activeSources.size, 0);
  assert.equal(audio.ambientSource, null);
  assert.ok(clearedTimers.includes(901));
  lateCallback();
  assert.equal(delayedCuePlayed, false);

  audio.beginMissionAudio();
  assert.equal(audio.missionAudioMuted, false);
  assert.equal(audio.master.gain.value, 1.2);
  assert.ok(audio.ambientSource);
});

test('a real one-shot sound source is tracked and stopped at mission end', async () => {
  let stopCount = 0;
  const source = { connect() {}, start() {}, stop() { stopCount++; } };
  const gain = { gain: { value: 1 }, connect() {} };
  const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } });
  const audio = Object.create(AudioManager.prototype);
  audio.context = {
    currentTime: 0,
    createBufferSource: () => source,
    createGain: () => gain,
    decodeAudioData: async () => ({ duration: 1 })
  };
  audio.master = { gain: param() };
  audio.proximityGain = { gain: param() };
  audio.activeSources = new Set();
  audio.scheduledAudioTimers = new Set();
  audio.soundBuffers = new Map();
  audio.soundLoads = new Map();
  audio.audioGeneration = 4;
  audio.missionAudioMuted = false;
  sandbox.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });

  await audio.playSound('resources/test-sound.mp3', 0.5);
  assert.equal(audio.activeSources.has(source), true);
  audio.stopMissionAudio();
  assert.equal(stopCount, 1);
  delete sandbox.fetch;
});

test('Hunter quick adjustments clamp to field bounds and emit the existing change event', () => {
  const ui = Object.create(UIManager.prototype);
  let dispatched = 0;
  const input = {
    value: '96', min: '0', max: '100', step: '1', disabled: false,
    setAttribute() {},
    removeAttribute() {},
    dispatchEvent(event) { assert.equal(event.type, 'change'); dispatched++; return true; }
  };
  ui.hunterAdjustTarget = input;
  ui.hunterAdjustPopover = { hidden: false };

  assert.equal(ui.applyHunterAdjustment(10), true);
  assert.equal(input.value, '100');
  assert.equal(dispatched, 1);
  input.value = '3';
  ui.hunterAdjustTarget = input;
  ui.hunterAdjustPopover.hidden = false;
  assert.equal(ui.applyHunterAdjustment(-10), true);
  assert.equal(input.value, '0');
  assert.equal(dispatched, 2);

  for (const [delta, value] of [[1, 51], [5, 55], [10, 60], [-1, 49], [-5, 45], [-10, 40]]) {
    input.value = '50';
    ui.hunterAdjustTarget = input;
    ui.hunterAdjustPopover.hidden = false;
    assert.equal(ui.applyHunterAdjustment(delta), true);
    assert.equal(input.value, String(value));
  }
  assert.equal(ui.applyHunterAdjustment(2), false);
});

test('opening a Hunter adjustment menu moves its expanded state to the newly clicked field', () => {
  const ui = Object.create(UIManager.prototype);
  const firstAttrs = {};
  const secondAttrs = {};
  const input = attrs => ({
    disabled: false,
    attrs,
    setAttribute(key, value) { this.attrs[key] = value; },
    getBoundingClientRect: () => ({ left: 30, top: 50, bottom: 70 })
  });
  ui.hunterAdjustPopover = { hidden: true, style: {}, getBoundingClientRect: () => ({ width: 220, height: 82 }) };
  ui.hunterAdjustTarget = input(firstAttrs);
  ui.hunterAdjustTarget.setAttribute('aria-expanded', 'true');
  sandbox.window.innerWidth = 900;
  sandbox.window.innerHeight = 700;

  ui.showHunterAdjustment(input(secondAttrs));

  assert.equal(firstAttrs['aria-expanded'], 'false');
  assert.equal(secondAttrs['aria-expanded'], 'true');
  assert.equal(ui.hunterAdjustPopover.hidden, false);
});
