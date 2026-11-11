const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { stripTypeScriptTypes } = require('node:module');

const root = path.join(__dirname, '..');

function fixture() {
  let now = Date.now();
  const writes = [];
  const pending = [];
  const db = { prepare(sql) { return { bind(...args) { return {
    async run() { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  }; } }; } };
  class Socket extends EventTarget {
    constructor() { super(); this.messages = []; this.closed = false; this.closeCode = null; }
    accept() {}
    send(data) {
      if (this.closed) throw new Error('Closed socket');
      this.peer.messages.push(data);
      this.peer.dispatchEvent(new MessageEvent('message', { data }));
    }
    close(code, reason) {
      if (this.closed) return;
      this.closed = this.peer.closed = true;
      this.closeCode = this.peer.closeCode = code;
      this.closeReason = this.peer.closeReason = reason;
      queueMicrotask(() => { this.dispatchEvent(new Event('close')); this.peer.dispatchEvent(new Event('close')); });
    }
  }
  class Pair { constructor() {
    this[0] = new Socket(); this[1] = new Socket();
    this[0].peer = this[1]; this[1].peer = this[0];
  } }
  class WorkerResponse extends Response {
    constructor(body, init) {
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      if (init?.status === 101) { Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init.webSocket; }
    }
  }
  class Clock extends Date { static now() { return now; } }
  const env = { DB: db, VOIDSHIFT_LAN_ENABLED: '1', VOIDSHIFT_LAN_HOST_KEY: 'a'.repeat(64) };
  const context = { waitUntil(promise) { pending.push(promise); } };
  const vmContext = vm.createContext({ env, crypto: globalThis.crypto, Request, Response: WorkerResponse,
    WebSocketPair: Pair, TextEncoder, TextDecoder, Uint8Array, Date: Clock,
    setTimeout, clearTimeout, URL, Map, Set, WeakMap, console });
  for (const file of ['db/rooms.ts', 'worker/lan.ts']) {
    const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, file), 'utf8'))
      .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, vmContext, { filename: file });
  }
  const handle = vm.runInContext('handleLanRequest', vmContext);
  const requests = async (endpoint, body, headers = {}) => handle(new Request(`http://192.168.1.5:8787/api/lan/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: 'http://192.168.1.5:8787', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, context);
  const drain = async () => { await new Promise(resolve => setImmediate(resolve)); await Promise.all(pending.splice(0)); };
  const host = async () => (await requests('create', { hostKey: env.VOIDSHIFT_LAN_HOST_KEY, createIntent: 'b'.repeat(64) })).json();
  const guest = async () => (await requests('join', {})).json();
  const connect = async credentials => {
    const sockets = {};
    for (const channel of ['state', 'events']) {
      const query = new URLSearchParams({ code: credentials.code, memberId: credentials.memberId,
        token: credentials.memberToken, generation: String(credentials.generation) });
      const response = await handle(new Request(`http://192.168.1.5:8787/api/lan/ws/${channel}?${query}`, {
        headers: { upgrade: 'websocket', origin: 'http://192.168.1.5:8787' },
      }), env, context);
      assert.equal(response.status, 101);
      sockets[channel] = response.webSocket;
    }
    return sockets;
  };
  const ackAll = socket => {
    for (let index = 0; index < socket.messages.length; index++) {
      const frame = JSON.parse(socket.messages[index]);
      if (frame.seq != null && !socket.closed) socket.send(JSON.stringify({ kind: 'ack', seq: frame.seq }));
    }
  };
  const dispose = async () => {
    const runtime = vm.runInContext('runtimeFor', vmContext)(db);
    for (const member of runtime.lobby?.members.values() || []) {
      for (const socket of Object.values(member.sockets)) socket.ws.close(1000, 'Test complete');
    }
    await drain();
  };
  return { env, db, context, handle, requests, host, guest, connect, writes, drain, ackAll, dispose,
    advance(ms) { now += ms; } };
}

test('LAN is disabled unless its local environment flag is exactly 1', async () => {
  const f = fixture();
  f.env.VOIDSHIFT_LAN_ENABLED = 'true';
  assert.equal((await f.requests('info')).status, 404);
  assert.equal(f.writes.length, 0);
});

test('an unfinished unauthenticated request body does not hold the lobby mutation lock', async () => {
  const f = fixture(); let controller; let timer;
  const body = new ReadableStream({ start(value) { controller = value; value.enqueue(new TextEncoder().encode('{')); } });
  const slow = f.handle(new Request('http://192.168.1.5:8787/api/lan/join', {
    method: 'POST', body, duplex: 'half', headers: { origin: 'http://192.168.1.5:8787' },
  }), f.env, f.context);
  try {
    const response = await Promise.race([f.requests('info'), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('partial body blocked the lobby')), 500);
    })]);
    assert.equal(response.status, 200);
  } finally {
    clearTimeout(timer); controller.close();
    assert.equal((await slow).status, 400);
    await f.dispose();
  }
});

test('host startup key is one-time, retry intent is idempotent, and real D1 guests have stable slots', async () => {
  const f = fixture();
  try {
    assert.equal((await f.requests('create', { hostKey: 'wrong' })).status, 403);
    const host = await f.host();
    assert.equal(host.memberId, 'host');
    assert.equal(host.protocolVersion, 20);
    assert.equal(f.writes.find(write => write.sql.startsWith('INSERT OR IGNORE INTO rooms')).args[2], 'LAN_WS_V20');
    const replay = await f.host();
    assert.equal(replay.hostToken, host.hostToken);
    assert.equal((await f.requests('create', { hostKey: f.env.VOIDSHIFT_LAN_HOST_KEY })).status, 409);
    const guests = await Promise.all([f.guest(), f.guest(), f.guest()]);
    assert.deepEqual(guests.map(guest => guest.slot), [2, 3, 4]);
    assert.equal((await f.requests('join', {})).status, 409);
    assert.equal(f.writes.filter(write => write.sql.startsWith('INSERT OR IGNORE INTO room_members')).length, 3);
    const info = await (await f.requests('info')).json();
    assert.equal(info.transport, 'LAN_WS_V20');
    assert.equal(info.room.members.length, 4);
    assert.equal(JSON.stringify(info).includes(host.hostToken), false);
  } finally { await f.dispose(); }
});

test('state delivery has one in-flight frame and replaces pending state with the latest value', async () => {
  const f = fixture();
  try {
    const host = await f.host(); const guest = await f.guest();
    const h = await f.connect(host); const g = await f.connect(guest);
    f.ackAll(h.events); f.ackAll(g.events);
    const send = n => h.state.send(JSON.stringify({ kind: 'data', payload: JSON.stringify({ version: 20, type: 'snapshot', n }) }));
    send(1); send(2); send(3);
    assert.equal(g.state.messages.length, 1);
    const first = JSON.parse(g.state.messages[0]);
    assert.equal(first.fromId, 'host');
    assert.equal(JSON.parse(first.payload).n, 1);
    g.state.send(JSON.stringify({ kind: 'ack', seq: first.seq }));
    assert.equal(g.state.messages.length, 2);
    assert.equal(JSON.parse(JSON.parse(g.state.messages[1]).payload).n, 3);
    g.state.send(JSON.stringify({ kind: 'data', targetId: 'another-guest', payload: JSON.stringify({ version: 20, type: 'input' }) }));
    assert.equal(g.state.closeCode, 1008);
  } finally { await f.dispose(); }
});

test('a lost guest allocation response may replay its private join intent without consuming another slot', async () => {
  const f = fixture();
  try {
    await f.host();
    const body = { joinIntent: 'c'.repeat(64) };
    const first = await (await f.requests('join', body)).json();
    const replay = await (await f.requests('join', body)).json();
    assert.equal(replay.memberId, first.memberId);
    assert.equal(replay.memberToken, first.memberToken);
    assert.equal(f.writes.filter(write => write.sql.startsWith('INSERT OR IGNORE INTO room_members')).length, 1);
    assert.equal((await f.requests('join', { joinIntent: 'wrong' })).status, 400);
  } finally { await f.dispose(); }
});

test('consumed startup key cannot create another lobby but the issued host token can recreate a closed lobby', async () => {
  const f = fixture();
  try {
    const host = await f.host();
    assert.equal((await f.requests('leave', { memberId: 'host', memberToken: host.memberToken })).status, 200);
    assert.equal((await f.requests('create', { hostKey: f.env.VOIDSHIFT_LAN_HOST_KEY, createIntent: 'd'.repeat(64) })).status, 409);
    const recreated = await f.requests('create', { createIntent: 'd'.repeat(64) }, { 'x-room-host-token': host.hostToken });
    assert.equal(recreated.status, 201);
    const next = await recreated.json();
    assert.notEqual(next.hostToken, host.hostToken);
    const replay = await f.requests('create', { createIntent: 'd'.repeat(64) }, { 'x-room-host-token': host.hostToken });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).hostToken, next.hostToken);
    assert.equal((await f.requests('status', { status: 'active' }, { 'x-room-host-token': host.hostToken })).status, 403);
  } finally { await f.dispose(); }
});

test('two authenticated channels establish D1 connected status and five-minute reconnect keeps ID and slot', async () => {
  const f = fixture();
  try {
    await f.connect(await f.host());
    const guest = await f.guest(); const sockets = await f.connect(guest);
    assert.ok(f.writes.some(write => write.sql.includes("status='connected'") && write.args[1] === guest.memberId));
    sockets.state.close(1000, 'Offline'); await f.drain();
    f.advance(4 * 60 * 1000);
    const resumed = await (await f.requests('join', guest)).json();
    assert.equal(resumed.memberId, guest.memberId); assert.equal(resumed.slot, guest.slot);
    assert.equal(resumed.generation, 1);
    const replacement = await f.connect(resumed);
    replacement.events.close(1000, 'Offline'); await f.drain();
    f.advance(5 * 60 * 1000 + 1);
    assert.equal((await f.requests('join', resumed)).status, 410);
  } finally { await f.dispose(); }
});

test('kick requires host authority, prevents reconnect, and permits bounded slot reuse', async () => {
  const f = fixture();
  try {
    const host = await f.host(); const guest = await f.guest();
    await f.connect(host); const sockets = await f.connect(guest);
    assert.equal((await f.requests('kick', { memberId: guest.memberId })).status, 403);
    assert.equal((await f.requests('kick', { memberId: guest.memberId }, { 'x-room-host-token': host.hostToken })).status, 200);
    f.ackAll(sockets.events);
    assert.equal(JSON.parse(sockets.events.messages.at(-1)).kind, 'kicked');
    assert.equal(sockets.events.closed, true);
    assert.equal((await f.requests('join', guest)).status, 410);
    const next = await f.guest();
    assert.equal(next.slot, guest.slot); assert.notEqual(next.memberId, guest.memberId);
    assert.equal((await f.requests('status', { status: 'active' }, { 'x-room-host-token': host.hostToken })).status, 200);
    assert.equal((await f.requests('join', {})).status, 409);
  } finally { await f.dispose(); }
});

test('event relay preserves chunks and routing while its queue closes an unacknowledged recipient at its bound', async () => {
  const f = fixture();
  try {
    const host = await f.host(); const guest = await f.guest();
    const h = await f.connect(host); const g = await f.connect(guest);
    f.ackAll(h.events); f.ackAll(g.events);
    const payload = JSON.stringify({ version: 20, type: 'reliable-chunk', id: 'transfer', index: 0, count: 2, data: 'e30=' });
    h.events.send(JSON.stringify({ kind: 'data', payload, targetId: guest.memberId }));
    assert.equal(JSON.parse(g.events.messages.at(-1)).payload, payload);
    for (let i = 0; i < 257; i++) h.events.send(JSON.stringify({ kind: 'data', payload, targetId: guest.memberId }));
    assert.equal(g.events.closeCode, 1013);
    assert.equal(g.events.closeReason, 'Reliable event queue full');
  } finally { await f.dispose(); }
});

test('the bounded 8 MiB wire queue admits the base64 frames of a legal 4 MiB source transfer', async () => {
  const f = fixture();
  try {
    const host = await f.host(); const guest = await f.guest();
    const h = await f.connect(host); const g = await f.connect(guest);
    f.ackAll(h.events); f.ackAll(g.events);
    const envelope = { version: 20, type: 'world', data: '' };
    const overhead = Buffer.byteLength(JSON.stringify(envelope));
    const bytes = Buffer.from(JSON.stringify({ ...envelope, data: 'x'.repeat(4 * 1024 * 1024 - overhead) }));
    const count = Math.ceil(bytes.length / 22000);
    let wireBytes = 0;
    for (let index = 0; index < count; index++) {
      const payload = JSON.stringify({ version: 20, type: 'reliable-chunk', id: 'full-transfer', index, count,
        data: Buffer.from(bytes.subarray(index * 22000, (index + 1) * 22000)).toString('base64') });
      const frame = JSON.stringify({ kind: 'data', payload, targetId: guest.memberId });
      wireBytes += Buffer.byteLength(frame);
      h.events.send(frame);
    }
    assert.ok(wireBytes > 4 * 1024 * 1024 && wireBytes < 8 * 1024 * 1024);
    assert.equal(g.events.closed, false);
    assert.equal(count, 191);
    f.ackAll(g.events);
    assert.equal(g.events.messages.filter(text => JSON.parse(text).kind === 'data').length, count);
  } finally { await f.dispose(); }
});

test('Worker wrapper returns the original upgraded Response before framework routing', async () => {
  const f = fixture();
  try {
    const host = await f.host();
    const query = new URLSearchParams({ code: host.code, memberId: host.memberId, token: host.memberToken, generation: '0' });
    let frameworkCalls = 0;
    const frameworkResponse = new Response('framework');
    const context = vm.createContext({ URL, handleLanRequest: f.handle, vinext: { async fetch() { frameworkCalls++; return frameworkResponse; } } });
    const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'worker/lan-worker.ts'), 'utf8'))
      .replace(/^import .*\r?\n/gm, '').replace(/^export \{.*\} from .*;\r?\n/gm, '')
      .replace(/^export default .*;\r?\n/gm, '').replace(/\bexport /g, '');
    vm.runInContext(source, context);
    const worker = vm.runInContext('createWorker()', context);
    f.env.LAN_ROOM = { idFromName(name) { assert.equal(name, 'voidshift-local-lobby'); return name; },
      get() { return { fetch(request) { return f.handle(request, f.env, f.context); } }; } };
    const request = new Request(`http://192.168.1.5:8787/api/lan/ws/state?${query}`, { headers: { upgrade: 'websocket', origin: 'http://192.168.1.5:8787' } });
    const upgraded = await worker.fetch(request, f.env, f.context);
    assert.equal(upgraded.status, 101); assert.ok(upgraded.webSocket);
    assert.equal(frameworkCalls, 0);
    assert.strictEqual(await worker.fetch(new Request('http://192.168.1.5:8787/game/index.html'), f.env, f.context), frameworkResponse);
    assert.equal(frameworkCalls, 1);
    assert.equal((await f.handle(new Request(request.url, { headers: { upgrade: 'websocket', origin: 'http://attacker.test' } }), f.env, f.context)).status, 403);
  } finally { await f.dispose(); }
});
