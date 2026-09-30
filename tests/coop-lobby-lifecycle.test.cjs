const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function node() {
  return { textContent: '', children: [], style: {}, dataset: {}, classList: { toggle() {} },
    setAttribute() {}, addEventListener() {}, append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); }, replaceChildren(...items) { this.children = items; } };
}
function harness() {
  const requests = [];
  class Peer extends EventTarget {
    constructor() { super(); this.connectionState = 'new'; this.iceGatheringState = 'complete'; }
    createDataChannel(label) { return Object.assign(new EventTarget(), { label, readyState: 'connecting', close() {} }); }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.currentRemoteDescription = value; }
    close() { this.connectionState = 'closed'; }
  }
  const context = vm.createContext({ window: { addEventListener() {} }, EventTarget, CustomEvent, AbortController, DOMException,crypto:globalThis.crypto,TextEncoder,TextDecoder,atob,btoa,setInterval:()=>1,clearInterval(){},
    RTCPeerConnection: Peer, setTimeout: () => 1, clearTimeout() {}, performance: { now: () => 1000 },
    document: { createElement: node }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/ice')
        ? { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turnConfigured: false }
        : { generation: 0, status: 'offered', offer_sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }) } };
    } });
  for (const file of ['config', 'entities', 'network', 'game', 'ui', 'menu']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
  }
  const classes = vm.runInContext('({CoopSession, Game, UIManager, SafehouseMenu})', context);
  return { ...classes, context, requests };
}
function gameFor(Game) {
  const game = Object.create(Game.prototype);
  Object.assign(game, { state: { running: false, coop: { role: null, members: [] } },
    ui: { coopJoinCode: { value: 'ABC234' }, setCoopPaused() {}, showToast() {} },
    updateCoopUI() {}, _syncLegacyRemoteAliases() {}, pendingCoopFinishes: new Map() });
  game.state.difficultyProfiles = game._sanitizeDifficultyProfiles();
  return game;
}

test('a pending join rejects duplicate join and competing host actions', async () => {
  const { Game } = harness(), game = gameFor(Game), pending = deferred();
  let joins = 0, hosts = 0;
  game.coopSession = { join: async () => { joins++; await pending.promise; }, host: async () => { hosts++; }, close() {} };
  const joining = game.joinCoopRoom();
  const duplicate = game.joinCoopRoom(), hosting = game.hostCoopRoom();
  pending.resolve(); await Promise.all([joining, duplicate, hosting]);
  assert.equal(joins, 1); assert.equal(hosts, 0); assert.ok(!game.state.coop.roomPending);
});

test('a cancelled join error cannot close or demote the next host room', async () => {
  const { Game } = harness(), game = gameFor(Game), pending = deferred();
  let closes = 0;
  game.coopSession = { join: () => pending.promise, close() { closes++; },
    host: async () => { Object.assign(game.state.coop, { role: 'host', code: 'DEF234' }); } };
  const joining = game.joinCoopRoom(); game.leaveCoopRoom(); await game.hostCoopRoom();
  const before = closes; pending.reject(new Error('old connection failed')); await joining;
  assert.equal(game.state.coop.role, 'host'); assert.equal(game.state.coop.code, 'DEF234'); assert.equal(closes, before);
});

test('closing during guest ICE gathering never sends a null-room answer', async () => {
  const { CoopSession, requests } = harness(), session = new CoopSession();
  Object.assign(session, { role: 'guest', roomCode: 'ABC234', memberId: 'guest-2', memberToken: 'test', _generation: 0 });
  const ice = deferred(), reached = deferred();
  session._waitForIce = () => { reached.resolve(); return ice.promise; };
  const connecting = session._connectGuestPeer(); await reached.promise; await session.close(false);
  ice.resolve(); await connecting;
  assert.equal(requests.filter(request => request.options.method === 'PUT').length, 0);
});

test('an obsolete peer close or late message never removes or updates its replacement', () => {
  const { CoopSession } = harness(), session = new CoopSession();
  const old = session._createPeerRecord('host', 0, 'guest');
  const channel = old.peer.createDataChannel('events:guest-2');session._bindChannel(channel, old);
  const replacement = session._createPeerRecord('host', 1, 'guest');
  let messages = 0;session.addEventListener('message', () => messages++);
  session._closePeer(old);
  channel.dispatchEvent(new CustomEvent('message', { detail: {} }));
  const event = new Event('message');event.data = JSON.stringify({ version: 15, type: 'ready', ready: true });channel.dispatchEvent(event);
  assert.equal(session.peers.get('host'), replacement);assert.equal(messages, 0);
});

test('a late host creation response cannot overwrite a newer guest session', async () => {
  const { CoopSession, context } = harness(), session = new CoopSession(), response = deferred();
  context.fetch = () => response.promise;
  let rooms = 0;session.addEventListener('room', () => rooms++);
  const hosting = session.host(); await session.close(false);
  Object.assign(session, { _closed: false, role: 'guest', roomCode: 'DEF234', memberId: 'guest-2' });
  response.resolve({ ok: true, json: async () => ({ code: 'ABC234', hostToken: 'old-token' }) });await hosting;
  assert.equal(session.roomCode, 'DEF234');assert.equal(session.role, 'guest');assert.equal(rooms, 0);
});

test('host lobby displays received armory and guest roster marks the local seat', () => {
  const { UIManager } = harness();
  const ui = new Proxy({}, { get(target, key) { return target[key] ||= node(); } });
  const member = { id: 'guest-2', slot: 2, connected: true, status: 'connected', armory: { loadout: { primary: 'smg', sidearm: 'pistol' } } };
  UIManager.prototype.updateCoopLobby.call(ui, { role: 'host', connected: true, members: [member] });
  const equipment = ui.coopMembersList.children[0].children[3];
  assert.equal(equipment.children[0]?.children.at(-1).textContent, '冲锋枪');
  UIManager.prototype.updateCoopLobby.call(ui, { role: 'guest', playerId: 'guest-2', connected: true, members: [{ ...member, armory: undefined, loadout: member.armory.loadout }] });
  assert.match(ui.coopMembersList.children[0].children[0].textContent, /你/);
});

test('pending connection disables both room-entry actions and the join code field', () => {
  const { UIManager } = harness();
  const ui = new Proxy({}, { get(target, key) { return target[key] ||= node(); } });
  UIManager.prototype.updateCoopLobby.call(ui, { role: null, roomPending: 'guest', members: [] });
  assert.equal(ui.coopHostButton.disabled, true);assert.equal(ui.coopJoinButton.disabled, true);assert.equal(ui.coopJoinCode.disabled, true);
});

test('a late member allocation cannot overwrite credentials for the new session', async () => {
  const { CoopSession, context } = harness(), session = new CoopSession(), allocation = deferred();
  Object.assign(session, { role: 'guest', roomCode: 'ABC234' });context.fetch = () => allocation.promise;
  const request = session._requestMemberSlot().catch(error=>assert.equal(error.name,'AbortError'));await session.close(false);
  Object.assign(session, { _closed: false, role: 'guest', roomCode: 'DEF234', memberId: 'new-member', memberToken: 'new-token' });
  allocation.resolve({ ok: true, json: async () => ({ memberId: 'old-member', memberToken: 'old-token', slot: 3, generation: 0 }) });await request;
  assert.equal(session.memberId, 'new-member');assert.equal(session.memberToken, 'new-token');
});

test('an old host poll response cannot create peers in a new room', async () => {
  const { CoopSession, context } = harness(), session = new CoopSession(), poll = deferred();
  Object.assign(session, { role: 'host', roomCode: 'ABC234', _roomExpiresAt: Date.now()+100000 });context.fetch = () => poll.promise;
  const request = session._pollForMembers();await session.close(false);
  Object.assign(session, { _closed: false, role: 'host', roomCode: 'DEF234' });
  poll.resolve({ ok: true, json: async () => ({ members: [{ id: 'old-member', slot: 2, generation: 0, status: 'waiting' }] }) });await request;
  assert.equal(session.peers.size, 0);
});

test('a normal guest stays guest and connects only when both game channels open', async () => {
  const { CoopSession, context } = harness(), session = new CoopSession();
  context.fetch = async (url, options = {}) => ({ ok: true, json: async () =>
    url === '/api/rooms/ABC234' ? { protocol_version: 18, expires_at: Date.now()+100000 }
      : url.endsWith('/ice') ? { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turnConfigured: false }
      : options.method === 'POST' ? { memberId: 'guest-2', memberToken: 'test', slot: 2, generation: 0 }
        : { status: 'offered', generation: 0, offer_sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }) } });
  let role, connected = 0;session.addEventListener('room', event => role = event.detail.role);session.addEventListener('connected', () => connected++);
  const joining=session.join('ABC234');for(let i=0;i<60;i++)await Promise.resolve();
  assert.equal(role, 'guest');assert.equal(session.localSlot, 2);
  const record = session.peers.get('host');record.peer.connectionState = 'connected';
  for(const label of ['state:guest-2','events:guest-2']){
    const channel = record.peer.createDataChannel(label);session._bindChannel(channel, record);channel.readyState = 'open';channel.dispatchEvent(new Event('open'));
    assert.equal(connected, label.startsWith('events') ? 1 : 0);
  }
  session._checkPeerConnected(record);await joining;assert.equal(connected, 1);assert.equal(session.connected, true);
});

test('a rejected old answer cannot tear down the reconnecting peer in the same session', async () => {
  const { CoopSession, Game, context } = harness(), session = new CoopSession(), game = gameFor(Game);
  const answer = deferred(), reached = deferred();game.coopSession = session;
  session.addEventListener('room', event => Object.assign(game.state.coop, { role: event.detail.role, code: event.detail.code }));
  context.fetch = async (url, options = {}) => {
    if(options.method === 'PUT'){reached.resolve();return answer.promise;}
    return { ok: true, json: async () => url === '/api/rooms/ABC234'
      ? { protocol_version: 18, expires_at: Date.now()+100000 }
      : url.endsWith('/ice') ? { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turnConfigured: false }
      : options.method === 'POST' ? { memberId: 'guest-2', memberToken: 'test', slot: 2, generation: 0 }
        : { status: 'offered', generation: 0, offer_sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }) } };
  };
  const joining = game.joinCoopRoom();await reached.promise;
  session._closePeer(session.peers.get('host'));const replacement = session._createPeerRecord('host', 1, 'guest');
  answer.reject(new Error('obsolete answer failed'));await joining;
  assert.equal(session._closed, false);assert.equal(session.peers.get('host'), replacement);assert.equal(game.state.coop.role, 'guest');
});

test('a current join failure clears pending state and lets the user retry', async () => {
  const { Game } = harness(), game = gameFor(Game);let closed = 0, shown;
  game.ui.showToast = message => shown = message;
  game.coopSession = { join: async () => { throw new Error('connection failed'); }, close() { closed++; } };
  await game.joinCoopRoom();assert.equal(closed, 1);assert.equal(shown, 'connection failed');assert.equal(game.state.coop.role, null);assert.ok(!game.state.coop.roomPending);
});

test('pending room allocation blocks both solo descent and borrowed training assets', () => {
  const { Game, context } = harness(), game = gameFor(Game);let audioStarted = 0, trainingStarted = 0;
  game.state.coop.roomPending = 'guest';game.audio = { ensureAudio() { audioStarted++; } };game.ui.showDescentTransition = () => {};
  context.TrainingSession = class { constructor(){trainingStarted++;} open(){} };
  game.start();game.state.transitioning = false;game.startTutorial();
  assert.equal(audioStarted, 0);assert.equal(trainingStarted, 0);
});

test('pending lobby keeps cancellation visible, blocks solo start and cancels on return to title', async () => {
  const { Game, SafehouseMenu, context } = harness(), game = gameFor(Game), nodes = new Map();
  const get = id => { if(!nodes.has(id))nodes.set(id,node());return nodes.get(id); };
  context.document = { createElement: node, getElementById: get, querySelector: get };
  game.state.coop.roomPending = 'guest';game.player = { armory: { loadout: {} } };game.ui.startButton = node();
  let closed = 0;game.coopSession = { close(){closed++;} };
  const menu = Object.create(SafehouseMenu.prototype);Object.assign(menu,{game,tab:'loadout',confirmLeave:async()=>true,setScreen(value){this.screen=value;}});
  menu.updateLobby();assert.equal(get('coopLeaveButton').hidden,false);assert.equal(game.ui.startButton.disabled,true);
  await menu.returnToTitle();assert.equal(closed,1);assert.ok(!game.state.coop.roomPending);assert.equal(menu.screen,'title');
});
