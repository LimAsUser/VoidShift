import { env } from "cloudflare:workers";
import { COOP_PROTOCOL_VERSION, ROOM_MEMBER_RECONNECT_MS, getRoomDb, hashMemberToken } from "@/db/rooms";

// This response is room-authorized, never a public credential/configuration file.
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "Pragma": "no-cache",
    "Vary": "x-room-host-token, x-room-member-id, x-room-member-token" };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  const { code: rawCode } = await context.params;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return reply({ error: "invalid_room" }, 400);
  const db = getRoomDb(), now = Date.now();
  const room = await db.prepare("SELECT host_token, protocol_version, status FROM rooms WHERE code = ? AND expires_at > ?")
    .bind(code, now).first<{ host_token: string; protocol_version: number; status: string }>();
  if (!room || room.protocol_version !== COOP_PROTOCOL_VERSION || !["lobby", "active"].includes(room.status)) return reply({ error: "room_not_found" }, 404);
  if (request.headers.get("x-room-host-token") !== room.host_token) {
    const id = request.headers.get("x-room-member-id") || "", token = request.headers.get("x-room-member-token") || "";
    if (!id || id.length > 100 || !token || token.length > 256) return reply({ error: "forbidden" }, 403);
    const member = await db.prepare("SELECT token_hash, status, offline_at FROM room_members WHERE room_code = ? AND id = ?")
      .bind(code, id).first<{ token_hash: string; status: string; offline_at: number | null }>();
    if (!member || !["waiting", "offered", "answered", "connected", "offline"].includes(member.status) ||
        member.status === "offline" && (!member.offline_at || now - member.offline_at > ROOM_MEMBER_RECONNECT_MS) ||
        await hashMemberToken(token) !== member.token_hash) return reply({ error: "forbidden" }, 403);
  }
  const username = env.VOIDSHIFT_TURN_USERNAME, credential = env.VOIDSHIFT_TURN_PASSWORD;
  const valid = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value);
  const iceServers: { urls: string; username?: string; credential?: string }[] = [
    { urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.relay.metered.ca:80" }
  ];
  const turnConfigured = valid(username) && valid(credential);
  if (turnConfigured) for (const urls of ["turn:global.relay.metered.ca:80", "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443", "turns:global.relay.metered.ca:443?transport=tcp"]) iceServers.push({ urls, username, credential });
  return reply({ iceServers, turnConfigured });
}
