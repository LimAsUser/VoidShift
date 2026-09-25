import {
  COOP_PROTOCOL_VERSION,
  createMemberId,
  createMemberToken,
  getRoomDb,
  hashMemberToken,
  MAX_GUESTS,
  ROOM_MEMBER_RECONNECT_MS
} from "@/db/rooms";

const normalizeCode = (value: string) => value.trim().toUpperCase();

async function getRoom(code: string) {
  return getRoomDb().prepare(
    "SELECT code, host_token, protocol_version, status, expires_at FROM rooms WHERE code = ? AND expires_at > ?"
  ).bind(code, Date.now()).first();
}

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const room = await getRoom(code);
  if (!room || room.protocol_version !== COOP_PROTOCOL_VERSION) {
    return Response.json({ error: "room_not_found" }, { status: 404 });
  }
  if (request.headers.get("x-room-host-token") !== room.host_token) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const now = Date.now();
  const db = getRoomDb();
  await db.prepare(
    "UPDATE room_members SET status = 'removed' WHERE room_code = ? AND ((status = 'offline' AND offline_at <= ?) OR (status IN ('waiting', 'offered', 'answered') AND created_at <= ?))"
  ).bind(code, now - ROOM_MEMBER_RECONNECT_MS, now - ROOM_MEMBER_RECONNECT_MS).run();
  const result = await db.prepare(
    "SELECT id, slot, generation, status, offline_at, answer_sdp FROM room_members WHERE room_code = ? ORDER BY slot"
  ).bind(code).all();
  return Response.json({ members: result.results || [] });
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeCode(rawCode);
  const room = await getRoom(code);
  if (!room || room.protocol_version !== COOP_PROTOCOL_VERSION || room.status === "finished") {
    return Response.json({ error: "room_unavailable" }, { status: 404 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = getRoomDb();
  const now = Date.now();
  if (typeof body?.memberId === "string" && typeof body.memberToken === "string") {
    const tokenHash = await hashMemberToken(body.memberToken);
    const member = await db.prepare(
      "SELECT id, slot, token_hash, generation, status, offline_at, created_at FROM room_members WHERE id = ? AND room_code = ?"
    ).bind(body.memberId, code).first();
    if (!member || member.token_hash !== tokenHash) return Response.json({ error: "invalid_member_token" }, { status: 403 });
    if (member.status === "removed" || (member.offline_at && now - Number(member.offline_at) > ROOM_MEMBER_RECONNECT_MS)) {
      await db.prepare("UPDATE room_members SET status = 'removed' WHERE id = ?").bind(member.id).run();
      return Response.json({ error: "reconnect_expired" }, { status: 410 });
    }
    const generation = Number(member.generation || 0) + 1;
    await db.prepare(
      "UPDATE room_members SET generation = ?, status = 'waiting', offer_sdp = NULL, answer_sdp = NULL, offline_at = NULL, created_at = ? WHERE id = ? AND room_code = ?"
    ).bind(generation, now, member.id, code).run();
    return Response.json({ memberId: member.id, memberToken: body.memberToken, slot: member.slot, generation });
  }

  if (room.status !== "lobby") return Response.json({ error: "mission_already_started" }, { status: 409 });
  await db.prepare(
    "UPDATE room_members SET status = 'removed' WHERE room_code = ? AND ((status = 'offline' AND offline_at <= ?) OR (status IN ('waiting', 'offered', 'answered') AND created_at <= ?))"
  ).bind(code, now - ROOM_MEMBER_RECONNECT_MS, now - ROOM_MEMBER_RECONNECT_MS).run();
  await db.prepare("DELETE FROM room_members WHERE room_code = ? AND status = 'removed'").bind(code).run();

  for (let slot = 2; slot <= MAX_GUESTS + 1; slot++) {
    const id = createMemberId();
    const memberToken = createMemberToken();
    const tokenHash = await hashMemberToken(memberToken);
    const inserted = await db.prepare(
      "INSERT OR IGNORE INTO room_members (id, room_code, slot, token_hash, generation, status, created_at) VALUES (?, ?, ?, ?, 0, 'waiting', ?)"
    ).bind(id, code, slot, tokenHash, now).run();
    if (inserted.meta.changes === 1) {
      return Response.json({ memberId: id, memberToken, slot, generation: 0 }, { status: 201 });
    }
  }
  return Response.json({ error: "room_full" }, { status: 409 });
}
