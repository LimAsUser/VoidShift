const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = {
  window: { addEventListener() {} },
  document: { visibilityState: 'visible', hasFocus: () => true, addEventListener() {} },
  performance: { now: () => 1000 },
  structuredClone
};
for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;'],
  ['js/ui.js', 'globalThis.UIManagerUnderTest = UIManager;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(root, file), 'utf8')}\n${exportCode}`, sandbox);
}

const Game = sandbox.GameUnderTest;
const UIManager = sandbox.UIManagerUnderTest;
const Config = sandbox.ConfigUnderTest;

test('host focus loss pauses both players and sends a reliable pause event', () => {
  const sent = [];
  const pauses = [];
  const game = Object.create(Game.prototype);
  game.state = {
    running: true, keys: { w: true }, fireHeld: true, lastTime: 10, nextFrameAt: 50,
    coop: { role: 'host', running: true, hostPaused: false }
  };
  game.remotePlayer = { angle: 1, activeSlot: 'sidearm', flashlight: true };
  game.remoteInput = { keys: { d: true }, fire: true, seq: 4 };
  game.ui = { setCoopPaused: paused => pauses.push(paused) };
  game.coopSession = { sendEvent: (...args) => sent.push(args) };
  sandbox.document.visibilityState = 'hidden';
  sandbox.document.hasFocus = () => false;

  game._handleCoopFocusChange();

  assert.equal(game.state.coop.hostPaused, true);
  assert.equal(Object.keys(game.state.keys).length, 0);
  assert.equal(game.state.fireHeld, false);
  assert.equal(game.state.nextFrameAt, 0);
  assert.equal(Object.keys(game.remoteInput.keys).length, 0);
  assert.equal(game.remoteInput.fire, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'coop-pause');
  assert.equal(sent[0][1].paused, true);
  assert.deepEqual(pauses, [true]);
});

test('guest applies host pause and resume messages while resetting frame timing', () => {
  const pauses = [];
  const game = Object.create(Game.prototype);
  game.state = {
    keys: { d: true }, fireHeld: true, lastTime: 10, nextFrameAt: 50,
    coop: { role: 'guest', running: true, hostPaused: false }
  };
  game.ui = { setCoopPaused: paused => pauses.push(paused) };

  game._handleCoopMessage('events', { type: 'coop-pause', paused: true });
  assert.equal(game.state.coop.hostPaused, true);
  assert.equal(Object.keys(game.state.keys).length, 0);
  assert.equal(game.state.fireHeld, false);
  assert.equal(game.state.nextFrameAt, 0);

  game._handleCoopMessage('events', { type: 'coop-pause', paused: false });
  assert.equal(game.state.coop.hostPaused, false);
  assert.deepEqual(pauses, [true, false]);
});

test('paused guest world stays frozen but still checks the existing disconnect timeout', () => {
  const game = Object.create(Game.prototype);
  let guestUpdates = 0;
  let disconnectChecks = 0;
  let doorUpdates = 0;
  game.state = { running: true, elapsed: 12, coop: { role: 'guest', running: true, hostPaused: true } };
  game.map = { advanceDoorAnimations() { doorUpdates++; return []; } };
  game.hunters = [];
  game._updateGuestCoop = () => { guestUpdates++; };
  game._checkCoopDisconnect = () => { disconnectChecks++; return false; };

  game.update(0.05);

  assert.equal(game.state.elapsed, 12);
  assert.equal(guestUpdates, 0);
  assert.equal(doorUpdates, 0);
  assert.equal(disconnectChecks, 1);
});

test('CO-OP lobby shows the friendly-fire control only to the host and reports its state to guests', () => {
  const control = { hidden: true };
  const toggle = { checked: false, disabled: false };
  const status = { hidden: true, textContent: '' };
  const ui = {
    coopStatus: { textContent: '' }, coopRoomCode: { textContent: '' }, coopLobby: { hidden: true },
    coopHostReady: { textContent: '' }, coopGuestReady: { textContent: '' }, coopReadyButton: { textContent: '', disabled: false },
    coopStartButton: { hidden: false, disabled: false }, coopLeaveButton: { disabled: false },
    coopHostButton: { disabled: false }, coopJoinButton: { disabled: false }, coopJoinCode: { disabled: false },
    coopFriendlyFireControl: control, coopFriendlyFireToggle: toggle, coopFriendlyFireStatus: status
  };

  UIManager.prototype.updateCoopLobby.call(ui, {
    role: 'host', code: 'ABC123', connected: true, localReady: false, remoteReady: false,
    running: false, friendlyFire: true
  });
  assert.equal(control.hidden, false);
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, false);

  UIManager.prototype.updateCoopLobby.call(ui, {
    role: 'guest', code: 'ABC123', connected: true, localReady: false, remoteReady: false,
    running: false, friendlyFire: false
  });
  assert.equal(control.hidden, true);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /关闭/);
});

test('host friendly-fire choice can change only in the lobby and is included in mission start', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = {
    coop: { role: 'host', connected: true, running: false, friendlyFire: true, localReady: true, remoteReady: true, remoteArmory: {} },
    selectedDifficulty: 'medium', hunterSettings: {}, finalTerminalSettings: {}
  };
  game.state.coop.members = [1, 2, 3].map(slot => ({
    id: `guest-${slot}`, slot: slot + 1, connected: true, ready: true, armory: { slot }
  }));
  game.player = { exportArmory: () => ({ ownedWeapons: {} }) };
  game.coopSession = { sendEvent: (...args) => sent.push(args) };
  game.updateCoopUI = () => {};
  let payload = null;
  game._beginCoopMission = value => { payload = value; };
  sandbox.crypto = { getRandomValues(array) { array[0] = 123; return array; } };

  assert.equal(game.setFriendlyFire(false), true);
  game.startCoopMission();
  assert.equal(payload.friendlyFire, false);
  assert.equal(sent[0][0], 'friendly-fire');
  assert.equal(sent[0][1].enabled, false);
  assert.equal(sent[1][0], 'start');

  game.state.coop.running = true;
  assert.equal(game.setFriendlyFire(true), false);
});

test('guest lobby state follows the host friendly-fire event', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'guest', running: false, friendlyFire: true } };
  game.updateCoopUI = () => {};

  game._handleCoopMessage('events', { type: 'friendly-fire', enabled: false });

  assert.equal(game.state.coop.friendlyFire, false);
});
