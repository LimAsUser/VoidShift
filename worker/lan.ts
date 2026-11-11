import {
  COOP_PROTOCOL_VERSION, MAX_GUESTS, ROOM_MEMBER_RECONNECT_MS,
  createRoomCode, createHostToken, createMemberId, createMemberToken,
  hashMemberToken, roomExpiry,
} from "../db/rooms";

export type LanEnv = {
  DB: D1Database;
  VOIDSHIFT_LAN_ENABLED?: string;
  VOIDSHIFT_LAN_HOST_KEY?: string;
  ASSETS?: Fetcher;
  LAN_ROOM?: DurableObjectNamespace;
};

export type LanContext = Pick<ExecutionContext, "waitUntil">;

export const LAN_TRANSPORT = "LAN_WS_V20";
export const LAN_LIMITS = {
  stateBytes: 1024 * 1024, eventBytes: 32_000,
  eventFrames: 256, eventQueueBytes: 8 * 1024 * 1024,
  ackTimeoutMs: 15_000,
};

type Channel = "state" | "events";
type Member = {
  id: string; slot: number; generation: number; tokenHash: string;
  status: "waiting" | "connected" | "offline" | "removed";
  offlineAt: number | null; createdAt: number;
  sockets: Partial<Record<Channel, Socket>>;
};
type Frame = Record<string, unknown> & { kind: string; seq?: number };
type Socket = {
  ws: WebSocket; channel: Channel; member: Member; generation: number;
  closed: boolean; sequence: number; inFlight: number | null;
  ackTimer: ReturnType<typeof setTimeout> | null;
  endTimer: ReturnType<typeof setTimeout> | null; ending: string | null;
  queue: { frame: Frame; bytes: number }[]; queueBytes: number;
  latest: Map<string, { frame: Frame; bytes: number }>;
};
type Lobby = {
  code: string; hostToken: string; status: string; expiresAt: number;
  members: Map<string, Member>; createIntent: string | null;
  createAuthHash: string | null;
  joinIntents: Map<string, { memberId: string; memberToken: string }>;
};
type Runtime = { lobby: Lobby | null; keyUsed: boolean; serial: Promise<unknown>; lastLeaseAt: number };
const runtimes = new WeakMap<D1Database, Runtime>();
const encoder = new TextEncoder();
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store" },
});
const error = (name: string, status: number) => json({ error: name }, status);

function runtimeFor(db: D1Database) {
  let runtime = runtimes.get(db);
  if (!runtime) {
    runtime = { lobby: null, keyUsed: false, serial: Promise.resolve(), lastLeaseAt: 0 };
    runtimes.set(db, runtime);
  }
  return runtime;
}

function serialized<T>(runtime: Runtime, operation: () => Promise<T>): Promise<T> {
  const pending = runtime.serial.then(operation, operation);
  runtime.serial = pending.catch(() => {});
  return pending;
}

function sameOrigin(request: Request, socket = false) {
  const origin = request.headers.get("origin");
  return (!socket || !!origin) && (!origin || origin === new URL(request.url).origin) &&
    request.headers.get("sec-fetch-site") !== "cross-site";
}

async function readBody(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function membersOf(lobby: Lobby) {
  return [...lobby.members.values()].filter(member => member.status !== "removed")
    .sort((a, b) => a.slot - b.slot)
    .map(({ id, slot, generation, status }) => ({ id, slot, generation, status }));
}

function publicRoom(lobby: Lobby | null) {
  return lobby ? { code: lobby.code, status: lobby.status, expiresAt: lobby.expiresAt, members: membersOf(lobby) } : null;
}

function credentials(lobby: Lobby, member: Member, memberToken: string) {
  return {
    code: lobby.code, memberId: member.id, memberToken, slot: member.slot,
    generation: member.generation, protocolVersion: COOP_PROTOCOL_VERSION,
    expiresAt: lobby.expiresAt, ...(member.id === "host" ? { hostToken: lobby.hostToken } : {}),
  };
}

function closeSocket(socket: Socket, code = 1000, reason = "Disconnected") {
  if (socket.closed) return;
  socket.closed = true;
  if (socket.ackTimer) clearTimeout(socket.ackTimer);
  if (socket.endTimer) clearTimeout(socket.endTimer);
  socket.ackTimer = null;
  socket.endTimer = null;
  socket.queue.length = 0;
  socket.queueBytes = 0;
  socket.latest.clear();
  try { socket.ws.close(code, reason); } catch { /* Socket already closed. */ }
  if (socket.ending && socket.channel === "events" && socket.member.sockets.state) {
    closeSocket(socket.member.sockets.state, code, reason);
  }
}

function flush(socket: Socket) {
  if (socket.closed || socket.inFlight != null) return;
  let next: { frame: Frame; bytes: number } | undefined;
  if (socket.channel === "state") {
    const first = socket.latest.keys().next();
    if (!first.done) { next = socket.latest.get(first.value); socket.latest.delete(first.value); }
  } else {
    next = socket.queue.shift();
    if (next) socket.queueBytes -= next.bytes;
  }
  if (!next) return;
  const seq = ++socket.sequence;
  socket.inFlight = seq;
  try { socket.ws.send(JSON.stringify({ ...next.frame, seq })); }
  catch { closeSocket(socket, 1011, "Send failed"); return; }
  socket.ackTimer = setTimeout(() => closeSocket(socket, 1013, "Application ACK timeout"), LAN_LIMITS.ackTimeoutMs);
}

function enqueue(socket: Socket | undefined, frame: Frame, sourceId = "server") {
  if (!socket || socket.closed || socket.ending) return;
  const bytes = encoder.encode(JSON.stringify(frame)).byteLength;
  if (socket.channel === "state") {
    socket.latest.set(sourceId, { frame, bytes });
  } else {
    if (socket.queue.length >= LAN_LIMITS.eventFrames || socket.queueBytes + bytes > LAN_LIMITS.eventQueueBytes) {
      closeSocket(socket, 1013, "Reliable event queue full");
      return;
    }
    socket.queue.push({ frame, bytes });
    socket.queueBytes += bytes;
  }
  flush(socket);
}

function endMemberSockets(member: Member, kind: "kicked" | "closed", reason: string) {
  const events = member.sockets.events;
  if (events && !events.closed) {
    // Removal cancels unsent game events; deliver the terminal control after the in-flight frame.
    events.queue.length = 0;
    events.queueBytes = 0;
    enqueue(events, { kind });
    events.ending = reason;
    events.endTimer = setTimeout(() => closeSocket(events, 1000, reason), 2000);
  }
  // Keep both channels until terminal ACK: the browser closes its pair on either disconnect.
  if ((!events || events.closed) && member.sockets.state) closeSocket(member.sockets.state, 1000, reason);
}

function announce(lobby: Lobby) {
  const frame = { kind: "members", members: membersOf(lobby), status: lobby.status };
  for (const member of lobby.members.values()) enqueue(member.sockets.events, frame);
}

async function expireOffline(lobby: Lobby, db: D1Database) {
  const now = Date.now();
  for (const member of lobby.members.values()) {
    if (member.status === "removed" || member.status === "connected") continue;
    if (now - (member.offlineAt ?? member.createdAt) <= ROOM_MEMBER_RECONNECT_MS) continue;
    member.status = "removed";
    if (member.id === "host") {
      lobby.status = "finished";
      await db.prepare("UPDATE rooms SET status='finished' WHERE code=?").bind(lobby.code).run();
      for (const peer of lobby.members.values()) {
        for (const socket of Object.values(peer.sockets)) closeSocket(socket, 1000, "Host reconnect expired");
      }
    } else {
      await db.prepare("UPDATE room_members SET status='removed' WHERE room_code=? AND id=?")
        .bind(lobby.code, member.id).run();
    }
  }
}

async function renew(lobby: Lobby, runtime: Runtime, db: D1Database, force = false) {
  const now = Date.now();
  if (!force && now - runtime.lastLeaseAt < 30_000) return;
  runtime.lastLeaseAt = now;
  lobby.expiresAt = roomExpiry(now);
  await db.prepare("UPDATE rooms SET expires_at=? WHERE code=? AND status != 'finished'")
    .bind(lobby.expiresAt, lobby.code).run();
}

async function createLobby(body: Record<string, unknown>, request: Request, env: LanEnv, runtime: Runtime) {
  const key = env.VOIDSHIFT_LAN_HOST_KEY;
  const intent = body.createIntent == null ? null : String(body.createIntent);
  if (intent != null && !/^[a-f0-9]{64}$/.test(intent)) return error("invalid_create_intent", 400);
  const suppliedToken = request.headers.get("x-room-host-token") || "";
  const owner = runtime.lobby && suppliedToken === runtime.lobby.hostToken;
  const replayOwner = intent && runtime.lobby?.createIntent === intent && runtime.lobby.status !== "finished" &&
    runtime.lobby.createAuthHash && suppliedToken && await hashMemberToken(suppliedToken) === runtime.lobby.createAuthHash;
  if (!owner && !replayOwner && (!key || !/^[a-f0-9]{64}$/.test(key) || body.hostKey !== key)) return error("forbidden", 403);
  if (runtime.keyUsed && !(owner && runtime.lobby?.status === "finished")) {
    if (intent && runtime.lobby?.createIntent === intent && runtime.lobby.status !== "finished") {
      return json(credentials(runtime.lobby, runtime.lobby.members.get("host")!, runtime.lobby.hostToken));
    }
    return error("host_key_used", 409);
  }
  if (runtime.lobby && runtime.lobby.status !== "finished") return error("lobby_exists", 409);
  const now = Date.now();
  const hostToken = createHostToken();
  const tokenHash = await hashMemberToken(hostToken);
  const createAuthHash = owner ? await hashMemberToken(suppliedToken) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createRoomCode();
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO rooms (code,host_token,offer_sdp,answer_sdp,claimed,protocol_version,status,created_at,expires_at,create_intent_hash) VALUES (?,?,?,NULL,0,?,'lobby',?,?,NULL)"
    ).bind(code, hostToken, LAN_TRANSPORT, COOP_PROTOCOL_VERSION, now, roomExpiry(now)).run();
    if (inserted.meta.changes !== 1) continue;
    const host: Member = { id: "host", slot: 1, generation: 0, tokenHash,
      status: "waiting", offlineAt: null, createdAt: now, sockets: {} };
    runtime.lobby = { code, hostToken, status: "lobby", expiresAt: roomExpiry(now),
      members: new Map([[host.id, host]]), createIntent: intent, createAuthHash, joinIntents: new Map() };
    runtime.keyUsed = true;
    runtime.lastLeaseAt = now;
    return json(credentials(runtime.lobby, host, hostToken), 201);
  }
  return error("room_code_unavailable", 503);
}

async function joinLobby(body: Record<string, unknown>, lobby: Lobby, db: D1Database) {
  await expireOffline(lobby, db);
  if (lobby.status === "finished") return error("room_unavailable", 410);
  if (body.memberId != null || body.memberToken != null) {
    const member = lobby.members.get(String(body.memberId));
    if (!member || typeof body.memberToken !== "string" ||
        await hashMemberToken(body.memberToken) !== member.tokenHash) return error("invalid_member_token", 403);
    if (member.status === "removed") return error("reconnect_expired", 410);
    // A repeated join while both channels remain open must not evict a live peer.
    if (member.status === "connected" || member.status === "waiting") return json(credentials(lobby, member, body.memberToken));
    for (const socket of Object.values(member.sockets)) closeSocket(socket, 1000, "Reconnecting");
    member.sockets = {};
    member.generation++;
    member.status = "waiting";
    member.offlineAt = null;
    member.createdAt = Date.now();
    if (member.id !== "host") {
      await db.prepare("UPDATE room_members SET generation=?,status='waiting',offline_at=NULL,created_at=? WHERE room_code=? AND id=? AND status != 'removed'")
        .bind(member.generation, member.createdAt, lobby.code, member.id).run();
    }
    announce(lobby);
    return json(credentials(lobby, member, body.memberToken));
  }
  const joinIntent = body.joinIntent == null ? null : String(body.joinIntent);
  if (joinIntent && !/^[a-f0-9]{64}$/.test(joinIntent)) return error("invalid_join_intent", 400);
  const previous = joinIntent ? lobby.joinIntents.get(joinIntent) : null;
  if (previous) {
    const member = lobby.members.get(previous.memberId);
    if (!member || member.status === "removed") return error("reconnect_expired", 410);
    return json(credentials(lobby, member, previous.memberToken));
  }
  if (lobby.status !== "lobby") return error("mission_already_started", 409);
  for (let slot = 2; slot <= MAX_GUESTS + 1; slot++) {
    if ([...lobby.members.values()].some(member => member.slot === slot && member.status !== "removed")) continue;
    const id = createMemberId();
    const token = createMemberToken();
    const tokenHash = await hashMemberToken(token);
    const createdAt = Date.now();
    const inserted = await db.prepare(
      "INSERT OR IGNORE INTO room_members (id,room_code,slot,token_hash,generation,status,created_at) VALUES (?,?,?,?,0,'waiting',?)"
    ).bind(id, lobby.code, slot, tokenHash, createdAt).run();
    if (inserted.meta.changes !== 1) continue;
    const member: Member = { id, slot, generation: 0, tokenHash, status: "waiting", offlineAt: null, createdAt, sockets: {} };
    lobby.members.set(id, member);
    if (joinIntent) {
      lobby.joinIntents.set(joinIntent, { memberId: id, memberToken: token });
      while (lobby.joinIntents.size > 64) lobby.joinIntents.delete(lobby.joinIntents.keys().next().value!);
    }
    announce(lobby);
    return json(credentials(lobby, member, token), 201);
  }
  return error("room_full", 409);
}

async function authenticate(lobby: Lobby, id: string, token: string) {
  const member = lobby.members.get(id);
  if (!member || !token || await hashMemberToken(token) !== member.tokenHash) return null;
  return member;
}

function routeFrame(socket: Socket, lobby: Lobby, text: unknown) {
  if (socket.closed || typeof text !== "string") { closeSocket(socket, 1008, "Text frames required"); return; }
  const max = socket.channel === "state" ? LAN_LIMITS.stateBytes : LAN_LIMITS.eventBytes;
  if (encoder.encode(text).byteLength > max * 2 + 1024) { closeSocket(socket, 1009, "Frame too large"); return; }
  let frame: Record<string, unknown>;
  try { frame = JSON.parse(text); } catch { closeSocket(socket, 1008, "Invalid frame"); return; }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) { closeSocket(socket, 1008, "Invalid frame"); return; }
  if (frame.kind === "ack") {
    if (frame.seq !== socket.inFlight) return;
    socket.inFlight = null;
    if (socket.ackTimer) clearTimeout(socket.ackTimer);
    socket.ackTimer = null;
    if (socket.ending && socket.queue.length === 0) { closeSocket(socket, 1000, socket.ending); return; }
    flush(socket);
    return;
  }
  if (frame.kind !== "data" || typeof frame.payload !== "string" || encoder.encode(frame.payload).byteLength > max) {
    closeSocket(socket, 1008, "Invalid data frame"); return;
  }
  let envelope: Record<string, unknown>;
  try { envelope = JSON.parse(frame.payload); } catch { closeSocket(socket, 1008, "Invalid payload"); return; }
  if (!envelope || envelope.version !== COOP_PROTOCOL_VERSION || typeof envelope.type !== "string") {
    closeSocket(socket, 1008, "Protocol mismatch"); return;
  }
  if (socket.member.status !== "connected" || socket.generation !== socket.member.generation || lobby.status === "finished") return;
  if (socket.member.id !== "host" && frame.targetId != null && frame.targetId !== "host") {
    closeSocket(socket, 1008, "Guests target host only"); return;
  }
  const recipients = socket.member.id === "host"
    ? [...lobby.members.values()].filter(member => member.id !== "host" && (!frame.targetId || member.id === frame.targetId))
    : [lobby.members.get("host")!];
  for (const recipient of recipients) {
    if (recipient.status === "connected") enqueue(recipient.sockets[socket.channel],
      { kind: "data", payload: frame.payload, fromId: socket.member.id }, socket.member.id);
  }
}

async function openSocket(request: Request, channel: Channel, lobby: Lobby, runtime: Runtime, env: LanEnv, context: LanContext) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return error("websocket_required", 426);
  if (!sameOrigin(request, true)) return error("forbidden_origin", 403);
  const query = new URL(request.url).searchParams;
  if (query.get("code") !== lobby.code) return error("room_not_found", 404);
  const member = await authenticate(lobby, query.get("memberId") || "", query.get("token") || "");
  if (!member) return error("forbidden", 403);
  if (member.status === "removed" || lobby.status === "finished" ||
      member.offlineAt != null && Date.now() - member.offlineAt > ROOM_MEMBER_RECONNECT_MS) return error("reconnect_expired", 410);
  if (query.get("generation") !== String(member.generation)) return error("stale_generation", 409);
  if (member.sockets[channel] && !member.sockets[channel]!.closed) return error("channel_already_open", 409);
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const socket: Socket = { ws: server, channel, member, generation: member.generation, closed: false,
    sequence: 0, inFlight: null, ackTimer: null, endTimer: null, ending: null, queue: [], queueBytes: 0, latest: new Map() };
  member.sockets[channel] = socket;
  const disconnected = () => {
    context.waitUntil(serialized(runtime, async () => {
      if (member.sockets[channel] !== socket || socket.generation !== member.generation) return;
      closeSocket(socket);
      if (member.status === "removed") return;
      for (const other of Object.values(member.sockets)) closeSocket(other, 1000, "Paired channel disconnected");
      member.sockets = {};
      member.status = "offline";
      member.offlineAt ??= Date.now();
      if (member.id !== "host") {
        await env.DB.prepare("UPDATE room_members SET status='offline',offline_at=COALESCE(offline_at,?) WHERE room_code=? AND id=? AND status != 'removed'")
          .bind(member.offlineAt, lobby.code, member.id).run();
      }
      for (const peer of lobby.members.values()) enqueue(peer.sockets.events, { kind: "member-offline", memberId: member.id });
      announce(lobby);
    }));
  };
  server.addEventListener("close", disconnected);
  server.addEventListener("error", disconnected);
  server.addEventListener("message", event => {
    routeFrame(socket, lobby, event.data);
    if (member.id === "host" && !socket.closed) context.waitUntil(renew(lobby, runtime, env.DB));
  });
  if (member.sockets.state && !member.sockets.state.closed && member.sockets.events && !member.sockets.events.closed) {
    member.status = "connected";
    member.offlineAt = null;
    if (member.id !== "host") {
      await env.DB.prepare("UPDATE room_members SET status='connected',offline_at=NULL WHERE room_code=? AND id=? AND generation=? AND status != 'removed'")
        .bind(lobby.code, member.id, member.generation).run();
    }
    announce(lobby);
  }
  return new Response(null, { status: 101, webSocket: client });
}

async function removeMember(lobby: Lobby, member: Member, db: D1Database, kicked: boolean) {
  member.status = "removed";
  endMemberSockets(member, kicked ? "kicked" : "closed", kicked ? "Kicked by host" : "Left room");
  if (member.id === "host") {
    lobby.status = "finished";
    await db.prepare("UPDATE rooms SET status='finished' WHERE code=?").bind(lobby.code).run();
    for (const peer of lobby.members.values()) {
      if (peer.id === "host") continue;
      peer.status = "removed";
      endMemberSockets(peer, "closed", "Room closed");
    }
    await db.prepare("UPDATE room_members SET status='removed',offline_at=NULL WHERE room_code=?")
      .bind(lobby.code).run();
  } else {
    await db.prepare("UPDATE room_members SET status='removed',offline_at=NULL WHERE room_code=? AND id=?")
      .bind(lobby.code, member.id).run();
  }
  announce(lobby);
}

export async function handleLanRequest(request: Request, env: LanEnv, context: LanContext) {
  if (env.VOIDSHIFT_LAN_ENABLED !== "1") return error("lan_disabled", 404);
  if (!env.DB) return error("database_unavailable", 503);
  if (!sameOrigin(request)) return error("forbidden_origin", 403);
  const path = new URL(request.url).pathname;
  const runtime = runtimeFor(env.DB);
  // Slow request bodies must not hold the shared lobby mutation lock.
  const body = request.method === "POST" ? await readBody(request) : null;
  return serialized(runtime, async () => {
    if (runtime.lobby) await expireOffline(runtime.lobby, env.DB);
    if (path === "/api/lan/info" && request.method === "GET") {
      return json({ enabled: true, protocolVersion: COOP_PROTOCOL_VERSION, transport: LAN_TRANSPORT,
        maxPlayers: MAX_GUESTS + 1, reconnectMs: ROOM_MEMBER_RECONNECT_MS, room: publicRoom(runtime.lobby) });
    }
    if (path.startsWith("/api/lan/ws/") && request.method === "GET") {
      const channel = path.slice("/api/lan/ws/".length);
      if (channel !== "state" && channel !== "events") return error("not_found", 404);
      if (!runtime.lobby) return error("room_not_found", 404);
      return openSocket(request, channel, runtime.lobby, runtime, env, context);
    }
    if (request.method !== "POST") return error("not_found", 404);
    if (!body) return error("invalid_body", 400);
    if (path === "/api/lan/create") return createLobby(body, request, env, runtime);
    const lobby = runtime.lobby;
    if (!lobby) return error("room_not_found", 404);
    if (path === "/api/lan/join") return joinLobby(body, lobby, env.DB);
    if (path === "/api/lan/leave") {
      const member = await authenticate(lobby, String(body.memberId || ""), String(body.memberToken || ""));
      if (!member) return error("forbidden", 403);
      await removeMember(lobby, member, env.DB, false);
      return json({ ok: true });
    }
    if (request.headers.get("x-room-host-token") !== lobby.hostToken) return error("forbidden", 403);
    if (path === "/api/lan/kick") {
      const member = lobby.members.get(String(body.memberId));
      if (!member || member.id === "host") return error("invalid_member", 400);
      await removeMember(lobby, member, env.DB, true);
      return json({ ok: true });
    }
    if (path === "/api/lan/status") {
      if (!["lobby", "active", "finished"].includes(String(body.status))) return error("invalid_status", 400);
      if (lobby.status === "finished") return error("room_unavailable", 410);
      lobby.status = String(body.status);
      await env.DB.prepare("UPDATE rooms SET status=?,expires_at=? WHERE code=?")
        .bind(lobby.status, roomExpiry(), lobby.code).run();
      await renew(lobby, runtime, env.DB, true);
      announce(lobby);
      return json({ ok: true, status: lobby.status, expiresAt: lobby.expiresAt });
    }
    return error("not_found", 404);
  });
}
