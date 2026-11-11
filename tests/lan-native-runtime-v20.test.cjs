const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');

const root = path.join(__dirname, '..');
const enabled = process.env.VOIDSHIFT_LAN_RUNTIME_TEST === '1';

test('built native Worker preserves WebSocket upgrades and LAN D1 mission reward receipts', { skip: !enabled, timeout: 45000 }, async () => {
  const requireWrangler = createRequire(require.resolve('wrangler/package.json'));
  const { Miniflare } = requireWrangler('miniflare');
  const hostKey = 'a'.repeat(64);
  const serverRoot = path.join(root, 'dist/server');
  const moduleFiles = fs.readdirSync(serverRoot, { recursive: true }).filter(file => /\.(?:m?js)$/.test(file));
  const modules = ['index.js', ...moduleFiles.filter(file => file !== 'index.js')]
    .map(file => ({ type: 'ESModule', path: path.join(serverRoot, file) }));
  const mf = new Miniflare({
    modules, modulesRoot: serverRoot,
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    bindings: { VOIDSHIFT_LAN_ENABLED: '1', VOIDSHIFT_LAN_HOST_KEY: hostKey },
    d1Databases: { DB: 'lan-v20-isolated-test' },
    durableObjects: { LAN_ROOM: { className: 'LanRoom', useSQLite: true } },
    assets: { directory: path.join(root, 'dist/client'), binding: 'ASSETS',
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
    host: '127.0.0.1', port: 0, cf: false,
  });
  const sockets = [];
  const origin = 'http://localhost';
  const request = (route, method = 'GET', body, headers = {}) => mf.dispatchFetch(`${origin}${route}`, {
    method, headers: { origin, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const open = async (credentials, channel) => {
    const query = new URLSearchParams({ code: credentials.code, memberId: credentials.memberId,
      token: credentials.memberToken, generation: String(credentials.generation) });
    const response = await mf.dispatchFetch(`${origin}/api/lan/ws/${channel}?${query}`, {
      headers: { origin, upgrade: 'websocket' },
    });
    assert.equal(response.status, 101);
    assert.ok(response.webSocket, 'native upgraded response must retain its WebSocket');
    const socket = response.webSocket;
    const frames = [];
    socket.addEventListener('message', event => {
      const frame = JSON.parse(event.data);
      frames.push(frame);
      if (frame.seq != null) { try { socket.send(JSON.stringify({ kind: 'ack', seq: frame.seq })); } catch { /* Teardown may close before a queued control arrives. */ } }
    });
    socket.accept();
    sockets.push(socket);
    return { socket, frames };
  };
  const waitFor = async check => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('native Worker frame was not delivered');
  };
  try {
    const db = await mf.getD1Database('DB');
    for (const filename of [
      '0000_damp_jack_murdock.sql', '0001_rainy_kylun.sql', '0002_four_player_coop.sql',
      '0003_reusable_guest_slots.sql', '0004_mission_rewards_and_create_intent.sql',
    ]) {
      const source = fs.readFileSync(path.join(root, 'drizzle', filename), 'utf8');
      for (const statement of source.split(';').map(value => value.replace(/--> statement-breakpoint/g, '').trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    const info = await (await request('/api/lan/info')).json();
    assert.equal(info.transport, 'LAN_WS_V20');
    const create = await request('/api/lan/create', 'POST', { hostKey, createIntent: 'b'.repeat(64) });
    assert.equal(create.status, 201);
    const host = await create.json();
    const guest = await (await request('/api/lan/join', 'POST', { joinIntent: 'c'.repeat(64) })).json();
    const guest2 = await (await request('/api/lan/join', 'POST', { joinIntent: '1'.repeat(64) })).json();
    const guest3 = await (await request('/api/lan/join', 'POST', { joinIntent: '2'.repeat(64) })).json();
    assert.equal((await request('/api/lan/join', 'POST', {})).status, 409);
    const hostState = await open(host, 'state'); await open(host, 'events');
    const guestState = await open(guest, 'state'); const guestEvents = await open(guest, 'events');
    const guest2State = await open(guest2, 'state'); await open(guest2, 'events');
    const guest3State = await open(guest3, 'state'); await open(guest3, 'events');
    hostState.socket.send(JSON.stringify({ kind: 'data', payload: JSON.stringify({ version: 20, type: 'snapshot', tick: 42 }) }));
    await waitFor(() => [guestState, guest2State, guest3State].every(channel => channel.frames.some(frame => frame.kind === 'data')));
    const frame = guestState.frames.find(frame => frame.kind === 'data');
    assert.equal(frame.fromId, 'host'); assert.equal(JSON.parse(frame.payload).tick, 42);
    const stored = await db.prepare('SELECT offer_sdp,protocol_version FROM rooms WHERE code=?').bind(host.code).first();
    assert.equal(stored.offer_sdp, 'LAN_WS_V20'); assert.equal(stored.protocol_version, 20);
    assert.equal((await db.prepare('SELECT status FROM room_members WHERE id=?').bind(guest.memberId).first()).status, 'connected');

    const missionId = 'lan_v20_runtime';
    const reportToken = 'd'.repeat(64); const claimToken = 'e'.repeat(64);
    const register = await request('/api/missions', 'POST', {
      missionId, roomCode: host.code, difficulty: 'easy', reportToken,
      participants: [{ playerId: 'host', name: 'Host', claimToken: 'f'.repeat(64) },
        { playerId: guest.memberId, name: 'Guest', claimToken }],
    }, { 'x-room-host-token': host.hostToken });
    assert.equal(register.status, 201, JSON.stringify(await register.clone().json()));
    const report = await request(`/api/missions/${missionId}/reports`, 'PUT', {
      players: [{ playerId: guest.memberId, outcome: 'success', counts: { hunter: 1, monster: 2, heavy: 0 } }],
    }, { 'x-mission-report-token': reportToken });
    assert.equal(report.status, 200, JSON.stringify(await report.clone().json()));
    const receipt = await request(`/api/missions/${missionId}/receipts/${guest.memberId}`, 'GET', undefined,
      { 'x-mission-claim-token': claimToken });
    assert.equal(receipt.status, 200);
    assert.equal((await receipt.json()).receipt.amount, 70);
    const kick = await request('/api/lan/kick', 'POST', { memberId: guest.memberId }, { 'x-room-host-token': host.hostToken });
    assert.equal(kick.status, 200);
    await waitFor(() => guestEvents.frames.some(frame => frame.kind === 'kicked'));
    assert.equal((await request('/api/lan/join', 'POST', guest)).status, 410);
    const replacement = await (await request('/api/lan/join', 'POST', { joinIntent: '3'.repeat(64) })).json();
    assert.equal(replacement.slot, guest.slot); assert.notEqual(replacement.memberId, guest.memberId);
  } catch (cause) {
    console.error('Native LAN runtime failure:', cause);
    throw cause;
  } finally {
    for (const socket of sockets) { try { socket.close(1000, 'Test complete'); } catch {} }
    await mf.dispose();
  }
});
