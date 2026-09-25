import { COOP_PROTOCOL_VERSION, getRoomDb, roomExpiry, validateSdp } from "@/db/rooms";

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const room = await getRoomDb().prepare(
    "SELECT code, host_token, offer_sdp, answer_sdp, claimed, protocol_version, status, expires_at FROM rooms WHERE code = ? AND expires_at > ?"
  ).bind(code, Date.now()).first();
  if (!room) return Response.json({ error: "room_not_found" }, { status: 404 });
  const isHost = request.headers.get("x-room-host-token") === room.host_token;
  return Response.json({
    code: room.code,
    protocol_version: room.protocol_version || 1,
    status: room.status || 'lobby',
    offer_sdp: room.protocol_version === COOP_PROTOCOL_VERSION ? null : room.offer_sdp,
    answer_sdp: isHost && room.protocol_version !== COOP_PROTOCOL_VERSION ? room.answer_sdp : null,
    claimed: room.claimed,
    expires_at: room.expires_at
  });
}

export async function PUT(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !validateSdp(body.answer)) {
    return Response.json({ error: "invalid_answer" }, { status: 400 });
  }
  const room = await getRoomDb().prepare("SELECT protocol_version FROM rooms WHERE code = ? AND expires_at > ?")
    .bind(code, Date.now()).first();
  if (!room || (room.protocol_version || 1) !== 1) return Response.json({ error: "protocol_mismatch" }, { status: 409 });
  const result = await getRoomDb().prepare(
    "UPDATE rooms SET answer_sdp = ?, claimed = 1 WHERE code = ? AND claimed = 0 AND expires_at > ?"
  ).bind(body.answer, code, Date.now()).run();
  if (result.meta.changes !== 1) return Response.json({ error: "room_unavailable" }, { status: 409 });
  return Response.json({ ok: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const room = await getRoomDb().prepare("SELECT host_token FROM rooms WHERE code = ? AND expires_at > ?")
    .bind(code, Date.now()).first();
  if (!room || request.headers.get("x-room-host-token") !== room.host_token) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !['active', 'lobby', 'finished'].includes(String(body.status))) {
    return Response.json({ error: "invalid_status" }, { status: 400 });
  }
  const now = Date.now();
  const expiresAt = body.status === 'active' ? now + 24 * 60 * 60 * 1000
    : body.status === 'finished' ? now + 5 * 60 * 1000 : roomExpiry(now);
  await getRoomDb().prepare("UPDATE rooms SET status = ?, expires_at = ? WHERE code = ?")
    .bind(body.status, expiresAt, code).run();
  return Response.json({ ok: true, expiresAt });
}

export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const db = getRoomDb();
  const code = normalizeCode(rawCode);
  const token = request.headers.get("x-room-host-token") || "";
  await db.prepare("DELETE FROM room_members WHERE room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND host_token = ?)")
    .bind(code, code, token).run();
  const result = await db.prepare("DELETE FROM rooms WHERE code = ? AND host_token = ?")
    .bind(code, token).run();
  if (result.meta.changes !== 1) return Response.json({ error: "forbidden" }, { status: 403 });
  return new Response(null, { status: 204 });
}
