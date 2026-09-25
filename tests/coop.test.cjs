const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = {
  window: { addEventListener() {} },
  document: {
    visibilityState: 'visible', hasFocus: () => true, addEventListener() {},
    createElement: () => ({ append(...children) { this.children = children; }, classList: { add() {} } })
  },
  performance: { now: () => 1000 },
  setTimeout: () => 1,
  clearTimeout() {},
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

function makeReviveGame({ rescuerId = 'host', rescuerLocal = true } = {}) {
  const rescuer = { x: 100, y: 100, downed: false, health: 100, oxygen: 100, dodgeTimer: 0, stunned: 0 };
  const downed = { x: 120, y: 100, downed: true, health: 0, oxygen: 0, bleedout: 30, reviveProgress: 0, dodgeTimer: 0 };
  const game = Object.create(Game.prototype);
  game.state = {
    running: true, tutorial: null, keys: {}, coop: { role: 'host', running: true, playerId: 'host', hostPaused: false }
  };
  game.player = rescuerLocal ? rescuer : downed;
  game.remotePlayers = new Map([[rescuerLocal ? 'guest-1' : rescuerId, {
    id: rescuerLocal ? 'guest-1' : rescuerId,
    slot: 2,
    player: rescuerLocal ? downed : rescuer,
    online: true,
    input: { keys: {} }
  }]]);
  game.coopReviveAssignments = new Map();
  game.ui = { showToast() {}, updateCoopRevivePrompt(text) { this.revivePrompt = text; } };
  return { game, rescuer, downed, rescuerEntry: [...game.remotePlayers.values()][0] };
}

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

test('host preserves the assigned seat when Peer connects before the first member poll', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', connected: false, members: [], rosterRevision: 0 } };
  game.remotePlayers = new Map();
  game.coopSession = { peers: new Map([['member-a', { connected: true, slot: 2 }]]), sendEvent: () => true };
  game.pendingCoopFinishes = new Map();
  game.updateCoopUI = () => {};

  game._setCoopMemberStatus('member-a', 'connected', false, 2);

  assert.equal(game.state.coop.members[0].slot, 2);
  assert.equal(game.state.coop.members[0].connected, true);
});

test('stale server member status cannot mark a locally disconnected Peer as connected again', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', connected: true, members: [{ id: 'member-a', slot: 2, status: 'offline', connected: false, ready: true }] } };
  game.remotePlayers = new Map();
  game.coopSession = {
    peers: new Map([['member-a', { connected: false, disconnectedNotified: true, closed: false, slot: 2 }]]),
    sendEvent: () => true
  };
  game.updateCoopUI = () => {};

  game._applyCoopMemberList([{ id: 'member-a', slot: 2, status: 'connected' }]);

  assert.equal(game.state.coop.members[0].status, 'offline');
  assert.equal(game.state.coop.members[0].connected, false);
  assert.equal(game.state.coop.members[0].ready, true);
});

test('guest shows ready as pending until the host confirms it', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'guest', connected: true, running: false, localReady: false, readyPending: false, readyRequestSeq: 0 } };
  game.coopSession = { sendEvent: (...args) => { sent.push(args); return true; } };
  game.player = { exportArmory: () => ({ owned: true }) };
  game.updateCoopUI = () => {};

  assert.equal(game.toggleCoopReady(), true);
  assert.equal(game.state.coop.localReady, false);
  assert.equal(game.state.coop.readyPending, true);
  assert.equal(sent[0][0], 'ready');
  assert.equal(sent[0][1].ready, true);
  assert.equal(sent[0][1].requestId, 1);
  game._handleCoopMessage('events', { type: 'ready-ack', requestId: 1, accepted: true, ready: true });
  assert.equal(game.state.coop.localReady, true);
  assert.equal(game.state.coop.readyPending, false);
});

test('guest treats its member row in a host roster as authoritative readiness', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'guest', playerId: 'member-a', localReady: true, readyPending: false, rosterRevision: 0, members: [] } };
  game.updateCoopUI = () => {};
  game._handleCoopMessage('events', {
    type: 'room-roster', revision: 1, hostReady: true,
    members: [{ id: 'member-a', slot: 2, status: 'connected', ready: false, readyRequestId: 1 }]
  });

  assert.equal(game.state.coop.hostReady, true);
  assert.equal(game.state.coop.localReady, false);
  assert.equal(game.state.coop.members[0].slot, 2);
});

test('host readiness request returns an acknowledgment tied to its transport peer', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', connected: true, localReady: true, rosterRevision: 0, members: [
    { id: 'member-a', slot: 2, status: 'connected', connected: true, ready: false }
  ] } };
  game.coopSession = {
    peers: new Map([['member-a', { connected: true, slot: 2 }]]),
    sendEvent: (...args) => { sent.push(args); return true; }
  };
  game.updateCoopUI = () => {};
  game._coopRosterSignature = '';

  game._handleCoopMessage('events', { type: 'ready', ready: true, requestId: 7 }, 'member-a');

  assert.equal(game.state.coop.members[0].ready, true);
  assert.ok(sent.some(([type, payload, target]) => type === 'ready-ack' && payload.requestId === 7 && payload.ready && target === 'member-a'));
  assert.ok(sent.some(([type]) => type === 'room-roster'));
});

test('host answers a newly connected guest roster request even when the roster signature is unchanged', () => {
  const sent = [];
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', connected: true, localReady: true, rosterRevision: 4, members: [
    { id: 'member-a', slot: 2, status: 'connected', connected: true, ready: true }
  ] } };
  game.coopSession = { peers: new Map([['member-a', { connected: true, slot: 2 }]]), sendEvent: (...args) => { sent.push(args); return true; } };
  game._coopRosterSignature = JSON.stringify({ hostReady: true, members: [{ id: 'member-a', slot: 2, status: 'connected', ready: true }] });

  game._handleCoopMessage('events', { type: 'request-roster' }, 'member-a');

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'room-roster');
  assert.equal(sent[0][2], 'member-a');
});

test('guest ignores an older roster revision after applying newer readiness state', () => {
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'guest', playerId: 'member-a', localReady: true, readyPending: false, rosterRevision: 5, members: [] } };
  game.updateCoopUI = () => {};

  game._handleCoopMessage('events', {
    type: 'room-roster', revision: 4, hostReady: false,
    members: [{ id: 'member-a', slot: 2, status: 'connected', ready: false }]
  });

  assert.equal(game.state.coop.localReady, true);
  assert.equal(game.state.coop.rosterRevision, 5);
});

test('guest ready request updates the host roster and returns the same confirmed state', () => {
  const host = Object.create(Game.prototype);
  const guest = Object.create(Game.prototype);
  const memberId = 'member-a';
  host.state = { coop: { role: 'host', connected: true, localReady: true, rosterRevision: 0, members: [
    { id: memberId, slot: 2, status: 'connected', connected: true, ready: false }
  ] } };
  guest.state = { coop: {
    role: 'guest', connected: true, playerId: memberId, localSlot: 2,
    localReady: false, readyPending: false, readyPendingValue: false, readyRequestSeq: 0,
    readyPendingRequestId: null, readyTimeout: null, rosterRevision: 0, members: []
  } };
  host.remotePlayers = new Map();
  host.pendingCoopFinishes = new Map();
  host.updateCoopUI = () => {};
  guest.updateCoopUI = () => {};
  guest.player = { exportArmory: () => ({ weapon: 'pistol' }) };
  host.coopSession = {
    peers: new Map([[memberId, { connected: true, slot: 2, eventChannel: { readyState: 'open' } }]]),
    sendEvent: (type, payload, target) => {
      if (!target || target === memberId) guest._handleCoopMessage('events', { ...payload, type }, 'host');
      return true;
    }
  };
  guest.coopSession = {
    sendEvent: (type, payload) => {
      host._handleCoopMessage('events', { ...payload, type }, memberId);
      return true;
    }
  };

  assert.equal(guest.toggleCoopReady(), true);

  assert.equal(host.state.coop.members[0].ready, true);
  assert.equal(guest.state.coop.localReady, true);
  assert.equal(guest.state.coop.readyPending, false);
  assert.equal(guest.state.coop.members[0].slot, 2);
  assert.equal(host.getCoopStartBlocker(), '');
});

test('host explains why a co-op start is blocked and never silently drops the request', () => {
  const notices = [];
  const game = Object.create(Game.prototype);
  game.state = { coop: { role: 'host', connected: true, running: false, localReady: true, members: [
    { id: 'member-a', slot: 2, status: 'connected', connected: true, ready: false }
  ] } };
  game.ui = { showToast: message => notices.push(message) };
  game.updateCoopUI = () => {};

  assert.equal(game.startCoopMission(), false);
  assert.match(notices[0], /队友.*准备/);
  game.state.coop.members[0].ready = true;
  game.coopSession = { peers: new Map([['member-a', { connected: false, eventChannel: { readyState: 'closed' } }]]) };
  assert.match(game.getCoopStartBlocker(), /连接已失效/);
});

test('lobby shows pending readiness and a concrete host start blocker', () => {
  const ui = {
    coopStatus: { textContent: '' }, coopRoomCode: { textContent: '' }, coopLobby: { hidden: true },
    coopHostReady: { textContent: '' }, coopGuestReady: { textContent: '' },
    coopMembersList: { replaceChildren() {} },
    coopReadyButton: { textContent: '', disabled: false }, coopStartButton: { hidden: false, disabled: false },
    coopStartHint: { textContent: '' }, coopLeaveButton: { disabled: false }, coopHostButton: { disabled: false },
    coopJoinButton: { disabled: false }, coopJoinCode: { disabled: false }, coopFriendlyFireControl: null,
    coopFriendlyFireToggle: null, coopFriendlyFireStatus: null
  };
  UIManager.prototype.updateCoopLobby.call(ui, {
    role: 'guest', code: 'ABC123', connected: true, readyPending: true, localReady: false,
    hostReady: false, members: [], running: false
  });
  assert.equal(ui.coopReadyButton.textContent, '等待确认…');
  assert.equal(ui.coopReadyButton.disabled, true);

  UIManager.prototype.updateCoopLobby.call(ui, {
    role: 'host', code: 'ABC123', connected: true, localReady: true,
    members: [{ id: 'member-a', slot: 2, status: 'connected', connected: true, ready: false }],
    startBlocker: '等待所有已连接队友准备。', running: false
  });
  assert.equal(ui.coopStartButton.disabled, true);
  assert.equal(ui.coopStartHint.textContent, '等待所有已连接队友准备。');
});

test('lobby never renders a connected but not-yet-slotted member as an empty seat', () => {
  const ui = {
    coopStatus: { textContent: '' }, coopRoomCode: { textContent: '' }, coopLobby: { hidden: true },
    coopHostReady: { textContent: '' }, coopGuestReady: { textContent: '' },
    coopMembersList: { replaceChildren(...rows) { this.rows = rows; } },
    coopReadyButton: { textContent: '', disabled: false }, coopStartButton: { hidden: false, disabled: false },
    coopStartHint: { textContent: '' }, coopLeaveButton: { disabled: false }, coopHostButton: { disabled: false },
    coopJoinButton: { disabled: false }, coopJoinCode: { disabled: false }, coopFriendlyFireControl: null,
    coopFriendlyFireToggle: null, coopFriendlyFireStatus: null
  };

  UIManager.prototype.updateCoopLobby.call(ui, {
    role: 'guest', code: 'ABC123', connected: true, localReady: false, hostReady: true,
    members: [{ id: 'member-a', status: 'connected', connected: true, ready: false }], running: false
  });

  assert.ok(ui.coopMembersList.rows.some(row => row.children?.[1]?.textContent === '座位同步中…'));
});

test('lobby exposes one host seat and three independently updated guest seats', () => {
  const ui = {
    coopStatus: { textContent: '' }, coopRoomCode: { textContent: '' }, coopLobby: { hidden: true, classList: { toggle() {} } },
    coopHostReady: { textContent: '' }, coopGuestReady: { textContent: '' },
    coopMembersList: { replaceChildren(...rows) { this.rows = rows; } },
    coopReadyButton: { textContent: '', disabled: false }, coopStartButton: { hidden: false, disabled: false },
    coopStartHint: { textContent: '' }, coopLeaveButton: { disabled: false }, coopHostButton: { disabled: false },
    coopJoinButton: { disabled: false }, coopJoinCode: { disabled: false }, coopFriendlyFireControl: null,
    coopFriendlyFireToggle: null, coopFriendlyFireStatus: null
  };

  UIManager.prototype.updateCoopLobby.call(ui, {
    role: 'host', code: 'ABC123', connected: true, localReady: true,
    members: [
      { id: 'guest-1', slot: 2, connected: true, ready: true },
      { id: 'guest-2', slot: 3, connected: true, ready: false },
      { id: 'guest-3', slot: 4, status: 'offline', connected: false, ready: false }
    ],
    running: false, startBlocker: '等待队友连接。'
  });

  assert.equal(ui.coopHostReady.textContent, '已准备');
  assert.equal(ui.coopGuestReady.textContent, '2 / 3 位队友已连接');
  assert.equal(ui.coopMembersList.rows.length, 3);
  assert.equal(ui.coopMembersList.rows[0].children[1].textContent, '已准备');
  assert.equal(ui.coopMembersList.rows[1].children[1].textContent, '未准备');
  assert.match(ui.coopMembersList.rows[2].children[1].textContent, /离线/);
});

test('one E interaction starts a three-second revive without requiring the key to stay down', () => {
  const { game, downed } = makeReviveGame();

  game.interact(game.player);
  assert.equal(game._updateCoopRevive(1), false);
  assert.equal(game._updateCoopRevive(1), false);
  assert.equal(game._updateCoopRevive(1), false);

  assert.equal(downed.downed, false);
  assert.equal(downed.health, 40);
  assert.equal(downed.oxygen, 30);
  assert.equal(downed.bleedout, 0);
});

test('movement cancels a started revive and clears its progress', () => {
  const { game, downed } = makeReviveGame();
  game.interact(game.player);
  game._updateCoopRevive(1);
  assert.equal(downed.reviveProgress, 1);

  game.state.keys.d = true;
  game._updateCoopRevive(0.1);

  assert.equal(downed.reviveProgress, 0);
  assert.equal(downed.downed, true);

  game.state.keys.d = false;
  game.interact(game.player);
  game._updateCoopRevive(1);
  game.player.x = 180;
  game._updateCoopRevive(0.1);
  assert.equal(downed.reviveProgress, 0);
});

test('a downed player still bleeds out when there is no active rescuer', () => {
  const { game, downed } = makeReviveGame();
  downed.bleedout = 0.05;

  assert.equal(game._updateCoopRevive(0.1), true);
  assert.equal(downed.bleedout, 0);
});

test('a guest interaction event starts a revive without holding E in the input state', () => {
  const { game, downed, rescuerEntry } = makeReviveGame({ rescuerId: 'guest-1', rescuerLocal: false });
  game._handleRemoteAction({ action: 'interact' }, 'guest-1');
  rescuerEntry.input.keys.e = false;

  game._updateCoopRevive(0.5);

  assert.equal(downed.reviveProgress, 0.5);
  assert.equal(downed.downed, true);

  rescuerEntry.input.keys.d = true;
  game._updateCoopRevive(0.1);
  assert.equal(downed.reviveProgress, 0);
});

test('revive prompt shows a contextual E action and hides when there is no nearby teammate', () => {
  const prompt = { hidden: true, textContent: '' };
  const ui = { coopRevivePrompt: prompt };

  UIManager.prototype.updateCoopRevivePrompt.call(ui, '队员 2 · 按 E 开始救援 · 移动会中断');
  assert.equal(prompt.hidden, false);
  assert.match(prompt.textContent, /按 E/);

  UIManager.prototype.updateCoopRevivePrompt.call(ui, '');
  assert.equal(prompt.hidden, true);
});

test('nearby teammate prompt changes from one-tap E guidance to live revive progress', () => {
  const { game, downed } = makeReviveGame();
  game._updateCoopRevivePrompt();
  assert.match(game.ui.revivePrompt, /按 E 开始救援/);

  game.interact(game.player);
  game._updateCoopRevivePrompt();
  assert.match(game.ui.revivePrompt, /救援中 0%/);

  game._updateCoopRevive(1);
  game._updateCoopRevivePrompt();
  assert.match(game.ui.revivePrompt, /救援中 33%/);

  downed.x = 200;
  game._updateCoopRevivePrompt();
  assert.equal(game.ui.revivePrompt, '');
});
