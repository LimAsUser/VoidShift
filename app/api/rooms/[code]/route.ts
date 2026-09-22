import { getRoomDb, validateSdp } from "@/db/rooms";

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const room = await getRoomDb().prepare(
    "SELECT code, host_token, offer_sdp, answer_sdp, claimed, expires_at FROM rooms WHERE code = ? AND expires_at > ?"
  ).bind(code, Date.now()).first();
  if (!room) return Response.json({ error: "room_not_found" }, { status: 404 });
  const isHost = request.headers.get("x-room-host-token") === room.host_token;
  return Response.json({
    code: room.code,
    offer_sdp: room.offer_sdp,
    answer_sdp: isHost ? room.answer_sdp : null,
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
  const result = await getRoomDb().prepare(
    "UPDATE rooms SET answer_sdp = ?, claimed = 1 WHERE code = ? AND claimed = 0 AND expires_at > ?"
  ).bind(body.answer, code, Date.now()).run();
  if (result.meta.changes !== 1) return Response.json({ error: "room_unavailable" }, { status: 409 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const result = await getRoomDb().prepare("DELETE FROM rooms WHERE code = ? AND host_token = ?")
    .bind(normalizeCode(rawCode), request.headers.get("x-room-host-token") || "").run();
  if (result.meta.changes !== 1) return Response.json({ error: "forbidden" }, { status: 403 });
  return new Response(null, { status: 204 });
}
