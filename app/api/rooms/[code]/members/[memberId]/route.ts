import { COOP_PROTOCOL_VERSION, getRoomDb, hashMemberToken, validateSdp } from "@/db/rooms";

const normalizeCode = (value: string) => value.trim().toUpperCase();

async function getAuthorizedMember(request: Request, code: string, memberId: string) {
  const db = getRoomDb();
  const room = await db.prepare(
    "SELECT host_token, protocol_version, status, expires_at FROM rooms WHERE code = ? AND expires_at > ?"
  ).bind(code, Date.now()).first();
  if (!room || room.protocol_version !== COOP_PROTOCOL_VERSION) return { error: "room_not_found", status: 404 as const };
  const member = await db.prepare(
    "SELECT id, slot, generation, status, token_hash, offer_sdp, answer_sdp, offline_at FROM room_members WHERE id = ? AND room_code = ?"
  ).bind(memberId, code).first();
  if (!member) return { error: "member_not_found", status: 404 as const };

  if (request.headers.get("x-room-host-token") === room.host_token) {
    return { room, member, role: "host" as const };
  }
  const token = request.headers.get("x-room-member-token") || "";
  if (token && await hashMemberToken(token) === member.token_hash) {
    return { room, member, role: "member" as const };
  }
  return { error: "forbidden", status: 403 as const };
}

export async function GET(request: Request, context: { params: Promise<{ code: string; memberId: string }> }) {
  const { code: rawCode, memberId } = await context.params;
  const code = normalizeCode(rawCode);
  const authorized = await getAuthorizedMember(request, code, memberId);
  if ("error" in authorized) return Response.json({ error: authorized.error }, { status: authorized.status });
  const { member, role } = authorized;
  return Response.json({
    memberId: member.id,
    slot: member.slot,
    generation: member.generation,
    status: member.status,
    offer_sdp: role === "member" ? member.offer_sdp : null,
    answer_sdp: role === "host" ? member.answer_sdp : null
  });
}

export async function PUT(request: Request, context: { params: Promise<{ code: string; memberId: string }> }) {
  const { code: rawCode, memberId } = await context.params;
  const code = normalizeCode(rawCode);
  const authorized = await getAuthorizedMember(request, code, memberId);
  if ("error" in authorized) return Response.json({ error: authorized.error }, { status: authorized.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { member, role } = authorized;
  const sdp = role === "host" ? body?.offer : body?.answer;
  if (!body || !validateSdp(sdp)) return Response.json({ error: "invalid_sdp" }, { status: 400 });
  if (member.status === "removed") return Response.json({ error: "member_removed" }, { status: 410 });
  if (body.generation == null || !Number.isInteger(Number(body.generation)) || Number(body.generation) < 0) {
    return Response.json({ error: "invalid_generation" }, { status: 400 });
  }
  if (Number(body.generation) !== Number(member.generation)) {
    return Response.json({ error: "stale_generation" }, { status: 409 });
  }
  const db = getRoomDb();
  // Freeze SDP for one generation. A lost response may safely replay this exact body.
  const result = role === "host"
    ? await db.prepare(
      "UPDATE room_members SET offer_sdp = ?, status = CASE WHEN offer_sdp IS NULL THEN 'offered' ELSE status END WHERE id = ? AND room_code = ? AND generation = ? AND status != 'removed' AND (offer_sdp IS NULL OR offer_sdp = ?)"
    ).bind(sdp, memberId, code, member.generation, sdp).run()
    : await db.prepare(
      "UPDATE room_members SET answer_sdp = ?, status = CASE WHEN answer_sdp IS NULL THEN 'answered' ELSE status END WHERE id = ? AND room_code = ? AND generation = ? AND status != 'removed' AND offer_sdp IS NOT NULL AND (answer_sdp IS NULL OR answer_sdp = ?)"
    ).bind(sdp, memberId, code, member.generation, sdp).run();
  if (result.meta.changes !== 1) {
    return Response.json({ error: "stale_generation_or_sdp_conflict" }, { status: 409 });
  }
  return Response.json({ ok: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ code: string; memberId: string }> }) {
  const { code: rawCode, memberId } = await context.params;
  const code = normalizeCode(rawCode);
  const authorized = await getAuthorizedMember(request, code, memberId);
  if ("error" in authorized) return Response.json({ error: authorized.error }, { status: authorized.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { member } = authorized;
  const status = String(body?.status || "");
  if (!body || !["connected", "offline", "removed"].includes(status)) {
    return Response.json({ error: "invalid_status" }, { status: 400 });
  }
  if (member.status === "removed") return Response.json({ error: "member_removed" }, { status: 410 });
  if (body.generation != null && (!Number.isInteger(Number(body.generation)) || Number(body.generation) !== Number(member.generation))) {
    return Response.json({ error: "stale_generation" }, { status: 409 });
  }
  const offlineAt = status === "offline" ? (member.offline_at || Date.now()) : null;
  const result = await getRoomDb().prepare(
    "UPDATE room_members SET status = ?, offline_at = CASE WHEN ? = 'offline' THEN COALESCE(offline_at, ?) ELSE NULL END WHERE id = ? AND room_code = ? AND generation = ? AND status != 'removed'"
  ).bind(status, status, offlineAt, memberId, code, member.generation).run();
  if (result.meta.changes !== 1) return Response.json({ error: "stale_generation_or_state" }, { status: 409 });
  return Response.json({ ok: true, status, offlineAt });
}
