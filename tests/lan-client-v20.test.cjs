const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function setup({ mode = 'lan', hostKey = null, room = true, enabled = true, savedHost = null, hostOnly = false, autoOpen = true } = {}) {
  const requests = [], sockets = [], stored = new Map(), history = [];
  const members = [{ id: 'host', slot: 1, generation: 0, status: 'connected' }, { id: 'guest-stable', slot: 2, generation: 0, status: 'connected' }];
  if (hostOnly) members.pop();
  const control = { autoOpen };
  let generation = 0;
  if (savedHost) stored.set('voidshift_lan_host_v20', JSON.stringify(savedHost));
  class Socket extends EventTarget {
    constructor(url) {
      super(); this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this);
      queueMicrotask(() => {
        if (!control.autoOpen || this.readyState !== 0) return;
        this.readyState = 1; this.dispatchEvent(new Event('open'));
        if (new URL(url).pathname.endsWith('/events')) queueMicrotask(() => this.receive({ kind: 'members', seq: 1, members, status: 'lobby' }));
      });
    }
    send(data) { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(JSON.parse(data)); }
    receive(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, value: '', disabled: false, textContent: '', dataset: {}, attributes: {}, classList: { toggle() {} }, setAttribute(name, value) { this.attributes[name] = value; } });
    return nodes.get(id);
  }
  const context = vm.createContext({
    EventTarget, Event, MessageEvent, CustomEvent, DOMException, URL, URLSearchParams, TextEncoder, TextDecoder,
    Uint8Array, AbortController, crypto: globalThis.crypto, btoa, atob, queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: mode === 'lan' ? '?mode=lan' : '', hash: hostKey ? `#lan-host=${hostKey}` : '', href: 'http://192.168.1.20:8787/game/index.html?mode=lan', pathname: '/game/index.html', host: '192.168.1.20:8787' },
    history: { replaceState(...args) { history.push(args); } },
    sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    WebSocket: Socket,
    document: { getElementById: node, querySelector: node, querySelectorAll: () => [] },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === '/api/lan/info') return { ok: true, json: async () => ({ enabled, protocolVersion: 20, transport: 'LAN_WS_V20', maxPlayers: 4, room: room ? { code: 'ABC234', status: 'lobby', members } : null }) };
      const identity = { code: 'ABC234', protocolVersion: 20, expiresAt: Date.now() + 600000, memberId: 'guest-stable', memberToken: 'guest-secret', slot: 2, generation: generation++ };
      if (url === '/api/lan/create') Object.assign(identity, { memberId: 'host', memberToken: 'host-secret', hostToken: 'host-secret', slot: 1, generation: 0 });
      return { ok: true, status: 200, json: async () => identity };
    },
    window: { addEventListener() {} }
  });
  for (const file of ['network', 'lan-network', 'game', 'ui']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
  return { context, requests, sockets, stored, history, node, control, classes: vm.runInContext('({LanCoopSession, CoopSession, Game, UIManager, LANRuntime})', context) };
}

test('LAN address validates authority and uses a separate HTTP game page with default 8787', () => {
  const { classes } = setup({ mode: 'online' });
  assert.equal(classes.LANRuntime.parseAddress('192.168.1.20').url, 'http://192.168.1.20:8787/game/index.html?mode=lan');
  assert.equal(classes.LANRuntime.parseAddress('100.95.0.2:9000').address, '100.95.0.2:9000');
  assert.equal(classes.LANRuntime.parseAddress('[::1]:8787').address, '[::1]:8787');
  for (const value of ['', '999.1.1.1', 'host:0', 'host:65536', 'user@host', 'http://host', 'host/path', 'host?key=x']) assert.throws(() => classes.LANRuntime.parseAddress(value));
});

test('host fragment is removed, runtime verifies locally, and guests cannot create rooms', async () => {
  const host = setup({ hostKey: 'a'.repeat(64) });
  await host.classes.LANRuntime.ready;
  assert.equal(host.history.length, 1); assert.equal(host.history[0][2], '/game/index.html?mode=lan');
  assert.equal(host.classes.LANRuntime.canHost, true); assert.equal(Object.isFrozen(host.classes.LANRuntime), true);
  assert.equal(JSON.stringify(host.classes.LANRuntime).includes('a'.repeat(64)), false);
  const guest = setup(); await guest.classes.LANRuntime.ready;
  const session = new guest.classes.LanCoopSession();
  await assert.rejects(session.host(), /只有房主电脑/); session.close(false);
  assert.equal(guest.requests.some(request => request.url === '/api/lan/create'), false);
});

test('two WebSockets authenticate same-origin identity and route reliable messages with ACK', async () => {
  const h = setup(), session = new h.classes.LanCoopSession(), messages = [];
  session.addEventListener('message', event => messages.push(event.detail));
  await session.join();
  assert.equal(h.sockets.length, 2); assert.equal(session.connected, true); assert.equal(session.isPeerReady('host'), true);
  for (const socket of h.sockets) {
    const url = new URL(socket.url); assert.equal(url.origin, 'ws://192.168.1.20:8787');
    assert.equal(url.searchParams.get('memberId'), 'guest-stable'); assert.equal(url.searchParams.get('token'), 'guest-secret');
  }
  const events = h.sockets[1];
  events.receive({ kind: 'data', fromId: 'host', seq: 2, payload: JSON.stringify({ version: 20, type: 'start', seed: 4 }) });
  assert.equal(messages[0].peerId, 'host'); assert.equal(messages[0].channel, 'events');
  assert.ok(events.sent.some(frame => frame.kind === 'ack' && frame.seq === 2));
  assert.equal(session.sendEvent('ready', { ready: true }), true);
  const frame = events.sent.find(frame => frame.kind === 'data'); assert.equal(JSON.parse(frame.payload).version, 20);
  session.close(false);
});

test('state drops stale sequence and retains only latest outbound state during pressure', async () => {
  const h = setup(), session = new h.classes.LanCoopSession(), messages = [];
  session.addEventListener('message', event => messages.push(event.detail.message)); await session.join();
  const state = h.sockets[0], incoming = seq => ({ kind: 'data', fromId: 'host', seq, payload: JSON.stringify({ version: 20, type: 'snapshot', tick: seq }) });
  state.receive(incoming(5)); state.receive(incoming(4)); state.receive(incoming(5));
  assert.equal(messages.length, 1); assert.equal(messages[0].tick, 5); assert.equal(state.sent.filter(frame => frame.kind === 'ack').length, 3);
  state.bufferedAmount = 100000; session.sendState('input', { seq: 1 }); session.sendState('input', { seq: 2 });
  assert.equal(session._stateLatest.size, 1); state.bufferedAmount = 0; session._flushLatestState();
  const sent = state.sent.filter(frame => frame.kind === 'data'); assert.equal(sent.length, 1); assert.equal(JSON.parse(sent[0].payload).seq, 2);
  session.close(false);
});

test('large reliable events use existing chunks and reassemble once', async () => {
  const h = setup(), session = new h.classes.LanCoopSession(), messages = [];
  session.addEventListener('message', event => messages.push(event.detail.message)); await session.join();
  const events = h.sockets[1]; session.sendEvent('rejoin-state', { text: '中'.repeat(30000) });
  const parts = events.sent.filter(frame => frame.kind === 'data'); assert.ok(parts.length > 1);
  parts.forEach((part, index) => events.receive({ ...part, fromId: 'host', seq: index + 2 }));
  assert.equal(messages.length, 1); assert.equal(messages[0].text.length, 30000);
  session.close(false);
});

test('reconnect reuses stable member credentials and closes old socket callbacks', async () => {
  const h = setup(), session = new h.classes.LanCoopSession(); await session.join();
  const old = h.sockets[1], id = session.memberId;
  session._lostConnection(1006); await session._reconnectLAN();
  assert.equal(session.memberId, id); assert.equal(session.localSlot, 2); assert.equal(session._generation, 1); assert.equal(session.connected, true);
  const latestJoin = h.requests.filter(request => request.url === '/api/lan/join').at(-1);
  assert.equal(JSON.parse(latestJoin.options.body).memberToken, 'guest-secret');
  old.receive({ kind: 'kicked', seq: 99 }); assert.equal(session.memberId, id);
  session.close(false);
});

test('mode UI keeps online room flow and excludes remote LAN hosting', () => {
  const h = setup({ mode: 'online' }), ui = { coopHostButton: h.node('host'), coopLanAddress: h.node('address') };
  h.classes.UIManager.prototype.updateCoopMode.call(ui, { mode: 'online', lanRuntime: h.classes.LANRuntime });
  assert.equal(h.node('coopOnlineJoinRow').hidden, false); assert.equal(h.node('coopLanJoinRow').hidden, true);
  h.classes.UIManager.prototype.updateCoopMode.call(ui, { mode: 'lan', lanRuntime: h.classes.LANRuntime });
  assert.equal(h.node('coopOnlineJoinRow').hidden, true); assert.equal(h.node('coopLanJoinRow').hidden, false); assert.equal(ui.coopHostButton.disabled, true);
  assert.equal(h.node('coopLanJoinButton').textContent, '打开 LAN 游戏');
});

test('session replacement detaches old events and is blocked during tasks', () => {
  const h = setup({ mode: 'online' }), game = Object.create(h.classes.Game.prototype), old = new EventTarget();
  old.close = () => {}; old.peers = new Map(); game.coopSession = old; game.coopMode = 'online';
  game.state = { coop: { members: [] }, running: false }; game.updateCoopUI = () => {}; game.ui = {};
  game._attachCoopSession(); assert.equal(game.setCoopMode('lan'), true);
  old.dispatchEvent(new CustomEvent('latency', { detail: { values: { stale: 1 } } })); assert.equal(game.state.coop.latencies, undefined);
  game.state.running = true; assert.equal(game.setCoopMode('online'), false); game.coopSession.close(false);
});

test('explicit retry of an unconfirmed guest allocation keeps the same join intent', async () => {
  const h = setup(), session = new h.classes.LanCoopSession(), fetch = h.context.fetch, attempts = [];
  h.context.fetch = async (url, options) => {
    if (url === '/api/lan/join') {
      attempts.push(JSON.parse(options.body));
      if (attempts.length === 1) throw new TypeError('response lost');
    }
    return fetch(url, options);
  };
  await assert.rejects(session.join(), /操作结果未确认/); assert.equal(session.canRetryJoin, true);
  await session.retryJoin(); assert.equal(attempts.length, 2);
  assert.match(attempts[0].joinIntent, /^[a-f0-9]{64}$/); assert.equal(attempts[1].joinIntent, attempts[0].joinIntent);
  session.close(false);
});

test('host recreation retains issued credential privately after leaving', async () => {
  const h = setup({ hostKey: 'a'.repeat(64) }), session = new h.classes.LanCoopSession();
  await session.host(); session.close(true); await session.host();
  const creates = h.requests.filter(request => request.url === '/api/lan/create');
  assert.equal(creates[1].options.headers['x-room-host-token'], 'host-secret');
  assert.notEqual(JSON.parse(creates[0].options.body).createIntent, JSON.parse(creates[1].options.body).createIntent);
  assert.equal(JSON.stringify(h.classes.LANRuntime).includes('host-secret'), false); session.close(false);
});

test('host lobby page refresh reclaims issued identity without persisting startup key', async () => {
  const savedHost = { code: 'ABC234', protocolVersion: 20, memberId: 'host', memberToken: 'host-secret', hostToken: 'host-secret', slot: 1, generation: 0 };
  const h = setup({ savedHost }), session = new h.classes.LanCoopSession(); await h.classes.LANRuntime.ready;
  assert.equal(h.classes.LANRuntime.canHost, true); await session.host();
  assert.equal(session.hostToken, 'host-secret'); assert.equal(h.requests.some(request => request.url === '/api/lan/create'), false);
  assert.equal(h.stored.get('voidshift_lan_host_v20').includes('lan-host'), false); session.close(false);
});

test('LAN kicked control enters existing failure settlement and retains registered claim polling', async () => {
  const h = setup(), session = new h.classes.LanCoopSession(); await session.join();
  try {
  const fixtureSource = fs.readFileSync(path.join(__dirname, 'game-rewards-v16.test.cjs'), 'utf8').split("\ntest(")[0];
  const fixtureContext = vm.createContext({ require, __dirname, setImmediate, structuredClone,
    crypto: globalThis.crypto, setTimeout, clearTimeout });
  vm.runInContext(`${fixtureSource}\nglobalThis.makeFixture = fixture;`, fixtureContext);
  const fixture = fixtureContext.makeFixture(), game = fixture.g;
  game.pendingCoopFinishes = new Map();
  game.state.coop = { role: 'guest', playerId: session.memberId, members: [], running: true, connected: true };
  game.coopSession = session; game._attachCoopSession();
  const access = { missionId: game.state.missionFxId, playerId: session.memberId, claimToken: 'b'.repeat(64) };
  await game.rewards.rememberAccess(access);
  const requests = []; game.rewards.request = async (...args) => { requests.push(args); return { status: 'pending' }; };
  h.sockets[1].receive({ kind: 'kicked', seq: 2 }); await fixture.settled();
  assert.equal(game.state.running, false); assert.equal(game.state.coop.role, null);
  assert.equal(game.state.rewardDepartureOutcome, 'kicked'); assert.equal(game.backpack.items.length, 0);
  assert.ok(game.rewards.read().claims[`${access.missionId}.${access.playerId}`]);
  assert.ok(requests.some(args => args[0].includes('/receipts/')));
  assert.equal(game.state.settlement.rewardStatus, '待结算');
  } finally { session.close(false); }
});

test('recovered host-alone sockets reset the outage clock before a later outage', async () => {
  const h = setup({ hostKey: 'a'.repeat(64), hostOnly: true }), session = new h.classes.LanCoopSession();
  try {
    await session.host(); assert.equal(session.connected, false);
    session._lostConnection(1006); session._reconnectStartedAt = Date.now() - 240000;
    await session._reconnectLAN();
    assert.equal(session._channelsOpen(), true); assert.equal(session._reconnectStartedAt, 0);
    session._lostConnection(1006);
    assert.ok(Date.now() - session._reconnectStartedAt < 1000);
    await session._reconnectLAN(); assert.equal(session._closed, false);
  } finally { session.close(false); }
});

test('host terminal reconnect expiry clears the local host lobby and pause state', async () => {
  const h = setup({ hostKey: 'a'.repeat(64), hostOnly: true }), session = new h.classes.LanCoopSession();
  const game = Object.create(h.classes.Game.prototype), pauses = [];
  game.coopSession = session; game.remotePlayers = new Map(); game.pendingCoopFinishes = new Map();
  game.remoteQtes = new Map(); game.state = { running: false, coop: { role: 'host', code: 'ABC234', playerId: 'host', members: [], hostPaused: true } };
  game.ui = { setCoopPaused: value => pauses.push(value) }; game.updateCoopUI = () => {};
  game._syncLegacyRemoteAliases = () => {}; game._clearReadyPending = () => {};
  game._attachCoopSession();
  try {
    await session.host(); session._lostConnection(1006);
    session._reconnectStartedAt = Date.now() - 300001; await session._reconnectLAN();
    assert.equal(game.state.coop.role, null); assert.equal(game.state.coop.code, null);
    assert.equal(game.state.coop.hostPaused, false); assert.equal(pauses.at(-1), false);
    assert.equal(session._closed, true);
  } finally { session.close(false); }
});

test('initial socket timeout retires callbacks and preserves issued identity for explicit retry', async () => {
  const h = setup({ autoOpen: false }), session = new h.classes.LanCoopSession();
  const makeAttempt = session._makeAttempt.bind(session);
  session._makeAttempt = () => makeAttempt(null, Date.now() + 20);
  try {
    await assert.rejects(session.join(), error => error.code === 'connect_timeout');
    const oldSockets = h.sockets.slice();
    assert.equal(oldSockets.every(socket => socket.readyState === 3), true);
    for (const socket of oldSockets) { socket.readyState = 1; socket.dispatchEvent(new Event('open')); }
    oldSockets[1].receive({ kind: 'members', seq: 1, members: [{ id: 'host', slot: 1, generation: 0, status: 'connected' }] });
    assert.equal(session.connected, false); assert.equal(session.connectionStatus.phase, 'failed');
    assert.equal(session._stateFlushTimer, null); assert.equal(session.memberId, 'guest-stable');
    assert.equal(session.canRetryJoin, true);
    h.control.autoOpen = true; session._makeAttempt = makeAttempt;
    await session.retryJoin(); assert.equal(session.connected, true);
    assert.equal(session.memberId, 'guest-stable');
  } finally { session.close(false); }
});

test('active host terminal expiry settles failure before clearing its reporting role', async () => {
  const h = setup({ hostKey: 'a'.repeat(64), hostOnly: true }), session = new h.classes.LanCoopSession();
  try {
    const fixtureSource = fs.readFileSync(path.join(__dirname, 'game-rewards-v16.test.cjs'), 'utf8').split("\ntest(")[0];
    const fixtureContext = vm.createContext({ require, __dirname, setImmediate, structuredClone, crypto: globalThis.crypto, setTimeout, clearTimeout });
    vm.runInContext(`${fixtureSource}\nglobalThis.makeFixture = fixture;`, fixtureContext);
    const fixture = fixtureContext.makeFixture(), game = fixture.g, reports = [];
    game.pendingCoopFinishes = new Map();
    game.state.coop = { role: 'host', playerId: 'host', members: [], running: true, connected: false };
    game.rewardMission = { missionId: game.state.missionFxId };
    game.rewards.queueReport = async (missionId, rows) => { reports.push({ missionId, rows }); };
    game.rewards.flush = async () => {};
    game.defeatLedger.record('heavy', 'heavy-1', 'host');
    game.coopSession = session; game._attachCoopSession();
    await session.host(); session._lostConnection(1006);
    session._reconnectStartedAt = Date.now() - 300001; await session._reconnectLAN(); await fixture.settled();
    assert.equal(game.state.running, false); assert.equal(game.state.coop.role, null);
    assert.equal(game.state.rewardDepartureOutcome, 'timeout'); assert.equal(game.backpack.items.length, 0);
    assert.ok(reports.some(report => report.rows.some(row => row.playerId === 'host' && row.outcome === 'timeout' && row.amount === 100)));
    assert.equal(game.state.money, 1000);
  } finally { session.close(false); }
});
