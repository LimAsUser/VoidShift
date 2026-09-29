const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function load(file, symbol, additions = {}) {
  const sandbox = { window: { addEventListener() {}, devicePixelRatio: 1 }, ...additions };
  vm.runInNewContext(`${read(file)}\nglobalThis.UnderTest = ${symbol};`, sandbox);
  return sandbox;
}
function node() {
  return { textContent: '', hidden: false, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, replaceChildren(...children) { this.children = children; } };
}
function canvas(width = 800, height = 600) {
  const calls = [];
  const ctx = {};
  for (const method of ['save', 'restore', 'setTransform', 'translate', 'rotate', 'scale', 'beginPath',
    'arc', 'fill', 'stroke', 'fillRect', 'moveTo', 'lineTo', 'closePath', 'fillText', 'setLineDash']) {
    ctx[method] = (...args) => calls.push({ method, args });
  }
  return { clientWidth: width, clientHeight: height, calls, ctx, getContext: () => ctx };
}

test('instruction and practice controls retry the lesson or exit the isolated training session', () => {
  const html = read('index.html');
  for (const className of ['tutorial-card-actions', 'tutorial-practice-actions']) {
    const actions = html.match(new RegExp(`<div class="${className}">([\\s\\S]*?)</div>`))[1];
    const calls = [];
    const game = { beginTutorialPractice() { calls.push('begin'); }, pauseTutorial() { calls.push('pause'); },
      retryTrainingLesson() { calls.push('retry'); }, exitTraining() { calls.push('exit'); } };
    for (const match of actions.matchAll(/onclick="([^"]+)"/g)) vm.runInNewContext(match[1], { game });
    assert.deepEqual(calls, className === 'tutorial-card-actions' ? ['begin', 'retry', 'exit'] : ['pause', 'retry', 'exit']);
  }
  assert.match(html, /id="trainingGoal"[^>]*aria-live="polite"/);
  assert.match(html, /js\/training\.js[^]*?js\/game\.js/);
});

test('completion presents training progress and time without normal reward or loss fields', () => {
  const sandbox = load('js/ui.js', 'UIManager');
  const ui = Object.create(sandbox.UnderTest.prototype);
  Object.assign(ui, { trainingCompleteProgress: node(), trainingCompleteDuration: node(),
    trainingCompleteDialog: { open: false, showModal() { this.open = true; } } });
  ui.showTrainingComplete({ completed: 18, total: 18, elapsedSeconds: 125 });
  assert.equal(ui.trainingCompleteProgress.textContent, '18 / 18');
  assert.equal(ui.trainingCompleteDuration.textContent, '02:05');
  assert.equal(ui.trainingCompleteDialog.open, true);
  const dialog = read('index.html').match(/<dialog[^>]*id="trainingCompleteDialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  assert.doesNotMatch(dialog, /settlementLoot|settlementAmmo|credit-value|回收估值|损失/);
  assert.match(dialog, /<form method="dialog"[\s\S]*返回安全屋/);
});

test('goal caption derives live distance and uses the supplied control hint', () => {
  const sandbox = load('js/ui.js', 'UIManager');
  const ui = Object.create(sandbox.UnderTest.prototype);
  ui.trainingGoal = node();
  ui.updateTrainingGoal({ x: 10, y: 20 }, { x: 40, y: 60, label: '补给舱门', kind: 'door', key: 'E' });
  assert.equal(ui.trainingGoal.textContent, '补给舱门 · 距离 50 · E');
  ui.updateTrainingGoal({ x: 10, y: 20 }, null);
  assert.equal(ui.trainingGoal.textContent, '');
});

test('navigation projects the beacon through the existing camera and leaves world state untouched', () => {
  const sandbox = load('js/renderer.js', 'Renderer', { Config: { VIEW_W: 800, VIEW_H: 600 } });
  const world = canvas();
  const renderer = new sandbox.UnderTest({ canvas: world, ctx: world.ctx });
  renderer.cameraOffsetX = 300;
  renderer.cameraOffsetY = 200;
  const state = { elapsed: 0, cameraZoom: 2, trainingGoal: { x: 120, y: 110, label: '靶场', kind: 'target' } };
  const before = JSON.stringify(state);
  renderer.drawTrainingGoal({ x: 100, y: 100 }, state);
  const arc = world.calls.find(call => call.method === 'arc');
  assert.ok(arc, 'the current target has a visible beacon');
  assert.deepEqual(arc.args.slice(0, 2), [440, 320]);
  assert.equal(JSON.stringify(state), before);
});

test('offscreen goals draw an edge arrow inside the viewport and inactive training draws nothing', () => {
  const sandbox = load('js/renderer.js', 'Renderer', { Config: { VIEW_W: 800, VIEW_H: 600 } });
  const world = canvas();
  const renderer = new sandbox.UnderTest({ canvas: world, ctx: world.ctx });
  renderer.drawTrainingGoal({ x: 0, y: 0 }, { cameraZoom: 1, trainingGoal: { x: 5000, y: 300, kind: 'door' } });
  const location = world.calls.find(call => call.method === 'translate');
  assert.ok(location);
  assert.ok(location.args[0] >= 16 && location.args[0] <= 784);
  assert.ok(location.args[1] >= 16 && location.args[1] <= 584);
  assert.ok(world.calls.some(call => call.method === 'rotate'));
  world.calls.length = 0;
  renderer.drawTrainingGoal({ x: 0, y: 0 }, { cameraZoom: 1 });
  assert.equal(world.calls.length, 0);
});

test('training navigation draws above the completed darkness mask without revealing world geometry', () => {
  const sandbox = load('js/renderer.js', 'Renderer', { Config: { VIEW_W: 800, VIEW_H: 600 } });
  const world = canvas(), vision = canvas();
  const renderer = new sandbox.UnderTest({ canvas: world, ctx: world.ctx, visionCtx: vision.ctx });
  renderer.drawOccludedVision = () => vision.ctx.fillRect(0, 0, 800, 600);
  renderer.drawCenteredVision({ x: 0, y: 0 }, {}, { cameraZoom: 1, trainingGoal: { x: 400, y: 300, kind: 'move' } });
  assert.equal(vision.calls[0].method, 'fillRect');
  assert.ok(vision.calls.some(call => call.method === 'arc'));
  assert.equal(world.calls.length, 0);
});

test('training preview renders all six named areas from its separate factory without touching map configuration', () => {
  const world = canvas(600, 300);
  const names = ['入口舱', '补给舱', 'Hunter 舱', 'Monster 舱', 'Heavy 舱', '撤离舱'];
  const map = { isTraining: true, worldRooms: names.map((title, index) => {
    const x = index % 3 * 200, y = Math.floor(index / 3) * 150;
    return { title, trainingArea: String(index), center: { x: x + 100, y: y + 75 },
      vertices: [{ x, y }, { x: x + 180, y }, { x: x + 180, y: y + 130 }, { x, y: y + 130 }] };
  }), doors: [], terminals: [], spawnPoint: { x: 40, y: 40 } };
  const sandbox = load('js/menu.js', 'SafehouseMenu', {
    document: { getElementById: id => id === 'trainingShipPreview' ? world : node() },
    Config: { currentScale: 'large', WORLD_W: 5000, WORLD_H: 4000 },
    MapManager: { createTraining: () => map }
  });
  const menu = Object.create(sandbox.UnderTest.prototype);
  const before = JSON.stringify(sandbox.Config);
  menu.drawTrainingPreview();
  assert.deepEqual(world.calls.filter(call => call.method === 'fillText').map(call => call.args[0]), names);
  assert.equal(JSON.stringify(sandbox.Config), before);
  const html = read('index.html').match(/<div id="tutorialContent"[\s\S]*?<\/section><\/div>/)[0];
  assert.doesNotMatch(html, /使用当前设施、难度与装备|正常任务奖励|继续当前任务/);
});

test('training controls can wrap and keep the launch action reachable on a narrow screen', () => {
  const css = read('menu.css');
  assert.match(css, /\.tutorial-card-actions,\s*\.tutorial-practice-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.tutorial-(?:card|practice) button[^}]*min-height:\s*44px/);
  assert.match(css, /\.tutorial-launch-card[^}]*position:\s*sticky/);
});

for (const waitSeconds of [undefined, 8]) {
  test(`extraction messages show ${waitSeconds ?? 30} seconds for the actual rescue wait`, () => {
    const sandbox = load('js/ui.js', 'UIManager');
    const ui = Object.create(sandbox.UnderTest.prototype);
    const messages = [];
    Object.assign(ui, { extractStatusText: node(), hudExtractStatus: node(), contractState: node(), missionTitle: node(),
      log: text => messages.push(text), showToast: text => messages.push(text) });
    ui.updateExtractionCalledState(waitSeconds);
    const expected = waitSeconds ?? 30;
    assert.equal(ui.extractStatusText.textContent, `救援到达 ${expected}秒`);
    assert.equal(ui.hudExtractStatus.textContent, `救援到达 ${expected}秒`);
    assert.equal(messages[0], `远端逃生舱已发出信号。救援约 ${expected} 秒后抵达。`);
    assert.equal(messages[1], `救援已呼叫 · ${expected}秒后抵达`);
  });
}

test('reset hides the active mission HUD and re-enables the launch action', () => {
  const sandbox = load('js/ui.js', 'UIManager', { document: { body: node() } });
  const ui = Object.create(sandbox.UnderTest.prototype);
  for (const field of ['startButton', 'prompt', 'missionTitle', 'contractState', 'missionState', 'resultTitle',
    'extractStatusText', 'hudExtractStatus', 'threatStatusText', 'oxygenText', 'hudOverlay']) ui[field] = node();
  ui.startButton.disabled = true;
  ui.hudOverlay.style.display = 'flex';
  ui.updateResetState();
  assert.equal(ui.hudOverlay.style.display, 'none');
  assert.equal(ui.startButton.disabled, false);
  assert.equal(ui.missionState.textContent, '未开始');
});

test('training exit confirmation describes asset restoration and normal abandon restores its warning', () => {
  const sandbox = load('js/ui.js', 'UIManager');
  const ui = Object.create(sandbox.UnderTest.prototype);
  Object.assign(ui, { abandonConfirmTitle: node(), abandonConfirmNote: node(), abandonConfirmButton: node(),
    abandonConfirmDialog: { open: false, showModal() { this.open = true; } } });
  ui.showAbandonConfirm(true, '本次任务会按失败结算，携带物资将失去。');
  assert.equal(ui.abandonConfirmTitle.textContent, '退出训练？');
  assert.match(ui.abandonConfirmNote.textContent, /恢复/);
  assert.doesNotMatch(ui.abandonConfirmNote.textContent, /失败结算|损失|失去/);
  assert.equal(ui.abandonConfirmButton.textContent, '退出训练');
  assert.equal(ui.abandonConfirmDialog.open, true);
  ui.showAbandonConfirm(false, '普通任务的原有警告');
  assert.equal(ui.abandonConfirmTitle.textContent, '确认放弃下潜？');
  assert.equal(ui.abandonConfirmNote.textContent, '普通任务的原有警告');
  assert.equal(ui.abandonConfirmButton.textContent, '确认放弃');
});

test('Monster area preview teaches shooting into dormancy and observing its 20-second recovery', () => {
  const elements = Object.fromEntries(['lessonTitle', 'lessonDescription', 'lessonKeys', 'lessonHint', 'trainingShipPreview']
    .map(id => [id, node()]));
  const sandbox = load('js/menu.js', 'SafehouseMenu', {
    document: { getElementById: id => elements[id], querySelectorAll: () => [], createElement: node }
  });
  const menu = Object.create(sandbox.UnderTest.prototype);
  menu.previewLesson(3);
  assert.match(elements.lessonDescription.textContent, /射击/);
  assert.match(elements.lessonDescription.textContent, /20 秒/);
  assert.doesNotMatch(elements.lessonDescription.textContent, /噪音|触发它苏醒/);
  assert.deepEqual(elements.lessonKeys.children.map(key => key.textContent), ['鼠标右键', '鼠标左键', 'R', 'T']);
  assert.match(elements.lessonHint.textContent, /20 秒/);
});
