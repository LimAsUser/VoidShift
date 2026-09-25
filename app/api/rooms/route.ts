import { COOP_PROTOCOL_VERSION, createHostToken, createRoomCode, getRoomDb, roomExpiry, validateSdp } from "@/db/rooms";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const protocolVersion = body?.protocolVersion === COOP_PROTOCOL_VERSION ? COOP_PROTOCOL_VERSION : 1;
  if (!body || (body.protocolVersion != null && protocolVersion !== COOP_PROTOCOL_VERSION) ||
      (protocolVersion === 1 && !validateSdp(body.offer))) {
    return Response.json({ error: "invalid_offer" }, { status: 400 });
  }

  const db = getRoomDb();
  const now = Date.now();
  await db.prepare("DELETE FROM rooms WHERE expires_at <= ?").bind(now).run();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createRoomCode();
    const hostToken = createHostToken();
    const result = await db.prepare(
      "INSERT OR IGNORE INTO rooms (code, host_token, offer_sdp, answer_sdp, claimed, protocol_version, status, created_at, expires_at) VALUES (?, ?, ?, NULL, 0, ?, 'lobby', ?, ?)"
    ).bind(code, hostToken, protocolVersion === COOP_PROTOCOL_VERSION ? "MULTI_PEER_V4" : body.offer, protocolVersion, now, roomExpiry(now)).run();
    if (result.meta.changes === 1) return Response.json({ code, hostToken, protocolVersion, expiresAt: roomExpiry(now) }, { status: 201 });
  }

  return Response.json({ error: "room_code_unavailable" }, { status: 503 });
}
