import { COOP_PROTOCOL_VERSION, createHostToken, createRoomCode, getRoomDb, hashMemberToken, roomExpiry, validateSdp } from "@/db/rooms";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const protocolVersion = body?.protocolVersion === COOP_PROTOCOL_VERSION ? COOP_PROTOCOL_VERSION : 1;
  if (!body || (body.protocolVersion != null && protocolVersion !== COOP_PROTOCOL_VERSION) ||
      (protocolVersion === 1 && !validateSdp(body.offer))) {
    return Response.json({ error: "invalid_offer" }, { status: 400 });
  }

  const db = getRoomDb();
  const now = Date.now();
  if (body.createIntent != null && (typeof body.createIntent !== "string" || !/^[a-f0-9]{64}$/.test(body.createIntent))) {
    return Response.json({ error: "invalid_create_intent" }, { status: 400 });
  }
  const intentHash = body.createIntent ? await hashMemberToken(String(body.createIntent)) : null;
  await db.prepare("DELETE FROM rooms WHERE expires_at <= ?").bind(now).run();

  const replay = async () => {
    if (!intentHash) return null;
    const room = await db.prepare("SELECT code,host_token,protocol_version,expires_at FROM rooms WHERE create_intent_hash=?")
      .bind(intentHash).first<{ code: string; host_token: string; protocol_version: number; expires_at: number }>();
    if (!room) return null;
    if (room.protocol_version !== protocolVersion) return Response.json({ error: "create_intent_conflict" }, { status: 409 });
    return Response.json({ code: room.code, hostToken: room.host_token, protocolVersion: room.protocol_version, expiresAt: room.expires_at });
  };
  const previous = await replay();
  if (previous) return previous;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createRoomCode();
    const hostToken = createHostToken();
    const result = await db.prepare(
      "INSERT OR IGNORE INTO rooms (code, host_token, offer_sdp, answer_sdp, claimed, protocol_version, status, created_at, expires_at, create_intent_hash) VALUES (?, ?, ?, NULL, 0, ?, 'lobby', ?, ?, ?)"
    ).bind(code, hostToken, protocolVersion === COOP_PROTOCOL_VERSION ? "MULTI_PEER_V18" : body.offer, protocolVersion, now, roomExpiry(now), intentHash).run();
    if (result.meta.changes === 1) return Response.json({ code, hostToken, protocolVersion, expiresAt: roomExpiry(now) }, { status: 201 });
    const concurrent = await replay();
    if (concurrent) return concurrent;
  }

  return Response.json({ error: "room_code_unavailable" }, { status: 503 });
}
