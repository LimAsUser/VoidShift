import { getRoomDb, hashMemberToken } from "@/db/rooms";

const RECEIPT_TTL = 7 * 24 * 60 * 60 * 1000;
const MISSION_TTL = RECEIPT_TTL + 24 * 60 * 60 * 1000;
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const validCredential = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const jsonError = (error: string, status: number) => Response.json({ error }, { status });
const difficultyMultiplier = (difficulty: string) => difficulty === "hard" ? 3 : difficulty === "medium" ? 2 : 1;
type Participant = { playerId: string; name: string; claimToken: string };
type MissionRow = { id: string; difficulty: string; report_token_hash: string; registration_hash: string; expires_at: number };
type ReceiptRow = {
  id: string; player_id: string; name: string; claim_token_hash: string; outcome: string | null;
  hunter: number; monster: number; heavy: number; amount: number; completed_at: number | null; expires_at: number;
};
type ReportPlayer = { playerId: string; outcome: string; counts: { hunter: number; monster: number; heavy: number } };

export async function registerMission(body: Record<string, unknown> | null, hostToken: string) {
  if (!body || !validId(body.missionId) || typeof body.roomCode !== "string" ||
      !["easy", "medium", "hard"].includes(String(body.difficulty)) || !validCredential(body.reportToken) ||
      !Array.isArray(body.participants) || body.participants.length < 1 || body.participants.length > 4) {
    return jsonError("invalid_mission", 400);
  }
  const participants: Participant[] = [];
  const identities = new Set<string>();
  for (const raw of body.participants) {
    if (!raw || !validId(raw.playerId) || !validCredential(raw.claimToken) || identities.has(raw.playerId)) {
      return jsonError("invalid_participants", 400);
    }
    identities.add(raw.playerId);
    participants.push({ playerId: raw.playerId, name: String(raw.name || "队员").slice(0, 40), claimToken: raw.claimToken });
  }
  if (!identities.has("host")) return jsonError("invalid_participants", 400);
  participants.sort((a, b) => a.playerId.localeCompare(b.playerId));
  const roomCode = body.roomCode.trim().toUpperCase();
  const hashes = await Promise.all(participants.map(p => hashMemberToken(p.claimToken)));
  const reportHash = await hashMemberToken(body.reportToken);
  const registrationHash = await hashMemberToken(JSON.stringify({ roomCode, difficulty: body.difficulty,
    participants: participants.map((p, i) => [p.playerId, p.name, hashes[i]]) }));
  const db = getRoomDb();
  const now = Date.now();
  // Only bounded-expiry mission records are removed. Room housekeeping is separate.
  await db.prepare("DELETE FROM missions WHERE expires_at <= ?").bind(now).run();
  const existing = await db.prepare("SELECT report_token_hash, registration_hash FROM missions WHERE id = ?")
    .bind(body.missionId).first<MissionRow>();
  if (existing) {
    if (existing.report_token_hash !== reportHash) return jsonError("forbidden", 403);
    if (existing.registration_hash !== registrationHash) return jsonError("mission_conflict", 409);
    return Response.json({ missionId: body.missionId, status: "registered" });
  }
  const room = await db.prepare("SELECT host_token, status FROM rooms WHERE code = ? AND expires_at > ?")
    .bind(roomCode, now).first<{ host_token: string; status: string }>();
  if (!room || room.host_token !== hostToken) return jsonError("forbidden", 403);
  if (!["lobby", "active"].includes(room.status)) return jsonError("room_unavailable", 409);
  const members = await db.prepare("SELECT id FROM room_members WHERE room_code = ? AND status = 'connected'")
    .bind(roomCode).all<{ id: string }>();
  const allowed = new Set(["host", ...(members.results || []).map(member => member.id)]);
  if (participants.some(p => !allowed.has(p.playerId))) return jsonError("invalid_participants", 400);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO missions (id,room_code,difficulty,report_token_hash,registration_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
      .bind(body.missionId, roomCode, body.difficulty, reportHash, registrationHash, now, now + MISSION_TTL),
    ...participants.map((p, i) => db.prepare(
      "INSERT OR IGNORE INTO mission_receipts (id,mission_id,player_id,name,claim_token_hash,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM missions WHERE id=? AND report_token_hash=? AND registration_hash=?)")
      .bind(`${body.missionId}.${p.playerId}`, body.missionId, p.playerId, p.name, hashes[i], now + MISSION_TTL, body.missionId, reportHash, registrationHash))
  ]);
  const stored = await db.prepare("SELECT report_token_hash, registration_hash FROM missions WHERE id = ?")
    .bind(body.missionId).first<MissionRow>();
  if (stored?.report_token_hash !== reportHash || stored.registration_hash !== registrationHash) return jsonError("mission_conflict", 409);
  return Response.json({ missionId: body.missionId, status: "registered" }, { status: 201 });
}

export async function reportMission(missionId: string, reportToken: string, body: Record<string, unknown> | null) {
  if (!validId(missionId) || !validCredential(reportToken)) return jsonError("forbidden", 403);
  const db = getRoomDb();
  const now = Date.now();
  const mission = await db.prepare("SELECT * FROM missions WHERE id = ? AND expires_at > ?").bind(missionId, now).first<MissionRow>();
  if (!mission || mission.report_token_hash !== await hashMemberToken(reportToken)) return jsonError("forbidden", 403);
  if (!body || !Array.isArray(body.players) || body.players.length < 1 || body.players.length > 4 || "amount" in body) return jsonError("invalid_report", 400);
  const players: ReportPlayer[] = [];
  const ids = new Set<string>();
  for (const p of body.players) {
    if (!p || !validId(p.playerId) || ids.has(p.playerId) || "amount" in p ||
        !["success", "failure", "quit", "kicked", "timeout"].includes(p.outcome) || !p.counts ||
        ["hunter", "monster", "heavy"].some(type => !Number.isSafeInteger(p.counts[type]) || p.counts[type] < 0 || p.counts[type] > 1_000_000)) {
      return jsonError("invalid_report", 400);
    }
    ids.add(p.playerId);players.push(p);
  }
  for (const p of players) {
    const receipt = await db.prepare("SELECT * FROM mission_receipts WHERE mission_id=? AND player_id=?")
      .bind(missionId, p.playerId).first<ReceiptRow>();
    if (!receipt) return jsonError("invalid_participant", 400);
    if (receipt.expires_at <= now) return jsonError("receipt_expired", 410);
    if (receipt.completed_at != null && (receipt.outcome !== p.outcome || receipt.hunter !== p.counts.hunter ||
        receipt.monster !== p.counts.monster || receipt.heavy !== p.counts.heavy)) return jsonError("receipt_frozen", 409);
  }
  // Each UPDATE is conditional. Concurrent replays can only freeze a row once.
  await db.batch(players.map(p => {
    const base = p.counts.hunter * 10 + p.counts.monster * 30 + p.counts.heavy * 100;
    const amount = base * difficultyMultiplier(mission.difficulty) * (p.outcome === "success" ? 1 : 0.5);
    return db.prepare("UPDATE mission_receipts SET outcome=?,hunter=?,monster=?,heavy=?,amount=?,completed_at=?,expires_at=? WHERE mission_id=? AND player_id=? AND completed_at IS NULL")
      .bind(p.outcome, p.counts.hunter, p.counts.monster, p.counts.heavy, amount, now, now + RECEIPT_TTL, missionId, p.playerId);
  }));
  for (const p of players) {
    const row = await db.prepare("SELECT * FROM mission_receipts WHERE mission_id=? AND player_id=?").bind(missionId, p.playerId).first<ReceiptRow>();
    if (!row || row.outcome !== p.outcome || row.hunter !== p.counts.hunter || row.monster !== p.counts.monster || row.heavy !== p.counts.heavy) {
      return jsonError("receipt_frozen", 409);
    }
  }
  await db.prepare("UPDATE missions SET expires_at=MAX(expires_at,?) WHERE id=?").bind(now + RECEIPT_TTL, missionId).run();
  return Response.json({ ok: true, missionId });
}

export async function readReceipt(missionId: string, playerId: string, claimToken: string) {
  if (!validId(missionId) || !validId(playerId) || !validCredential(claimToken)) return jsonError("forbidden", 403);
  const db = getRoomDb();
  const row = await db.prepare("SELECT r.*,m.difficulty FROM mission_receipts r JOIN missions m ON m.id=r.mission_id WHERE r.mission_id=? AND r.player_id=?")
    .bind(missionId, playerId).first<ReceiptRow & { difficulty: string }>();
  if (!row || row.claim_token_hash !== await hashMemberToken(claimToken)) return jsonError("forbidden", 403);
  if (row.expires_at <= Date.now()) return jsonError("receipt_expired", 410);
  if (row.completed_at == null) return Response.json({ status: "pending", missionId });
  return Response.json({ status: "complete", receipt: {
    id: row.id, missionId, playerId, name: row.name, outcome: row.outcome,
    counts: { hunter: row.hunter, monster: row.monster, heavy: row.heavy },
    baseReward: row.hunter * 10 + row.monster * 30 + row.heavy * 100,
    difficultyMultiplier: difficultyMultiplier(row.difficulty), resultMultiplier: row.outcome === "success" ? 1 : 0.5,
    amount: row.amount, completedAt: row.completed_at, expiresAt: row.expires_at
  } });
}
