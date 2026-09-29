const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
const sandbox = { window: { addEventListener() {} }, performance: { now: () => 123 } };
vm.runInNewContext(`${source}\nglobalThis.GameUnderTest = Game;`, sandbox);
const GameUnderTest = sandbox.GameUnderTest;

function makeTutorialGame() {
  const cards = [];
  const game = Object.create(GameUnderTest.prototype);
  game.state = {
    running: false,
    elapsed: 0,
    coop: { role: null },
    tutorial: { active: true, paused: false, step: 0, progress: {} },
    keys: {},
    fireHeld: false
  };
  game.player = { armory: { loadout: { primary: null, sidearm: 'pistol' } } };
  game.ui = {
    showTutorialCard: (...args) => cards.push(['card', ...args]),
    showTutorialPractice: (...args) => cards.push(['practice', ...args]),
    hideTutorial: () => cards.push(['hide']),
    showToast: message => cards.push(['toast', message])
  };
  game.tutorialCards = cards;
  return game;
}

test('movement lesson pauses only after both walking and sprinting', () => {
  const game = makeTutorialGame();

  game._tutorialAction('move');
  assert.equal(game.state.tutorial.step, 0);
  assert.equal(game.state.tutorial.paused, false);

  game._tutorialAction('sprint');
  assert.equal(game.state.tutorial.step, 1);
  assert.equal(game.state.tutorial.paused, true);
  assert.equal(game.tutorialCards.at(-1)[0], 'card');
});

test('tutorial launcher refuses co-op before creating any training state', () => {
  const game = makeTutorialGame();
  let started = false;
  game.start = tutorialMode => { started = tutorialMode === true; };
  game.state.coop.role = 'host';

  game.startTutorial();
  assert.equal(started, false);

  assert.equal(game.trainingSession, undefined);
});

test('skipping guidance hides the tutorial while leaving the same mission running', () => {
  const game = makeTutorialGame();
  game.state.running = true;

  game.skipTutorial();

  assert.equal(game.state.tutorial, null);
  assert.equal(game.state.running, true);
  assert.equal(game.state.fireHeld, false);
  assert.deepEqual(game.tutorialCards.at(-2), ['hide']);
  assert.equal(game.tutorialCards.at(-1)[0], 'toast');
});

test('instruction cards freeze elapsed mission time until practice begins', () => {
  const game = makeTutorialGame();
  game.state.tutorial.paused = true;

  game.update(5);
  assert.equal(game.state.elapsed, 0);

  game.beginTutorialPractice();
  assert.equal(game.state.tutorial.paused, false);
  assert.equal(game.tutorialCards.at(-1)[0], 'practice');
});
