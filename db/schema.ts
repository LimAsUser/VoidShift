import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  hostToken: text("host_token").notNull().default(""),
  offerSdp: text("offer_sdp").notNull(),
  answerSdp: text("answer_sdp"),
  claimed: integer("claimed", { mode: "boolean" }).notNull().default(false),
  protocolVersion: integer("protocol_version").notNull().default(1),
  status: text("status").notNull().default("lobby"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createIntentHash: text("create_intent_hash"),
}, table => [uniqueIndex("rooms_create_intent_unique").on(table.createIntentHash)]);

export const roomMembers = sqliteTable("room_members", {
  id: text("id").primaryKey(),
  roomCode: text("room_code").notNull().references(() => rooms.code, { onDelete: "cascade" }),
  slot: integer("slot").notNull(),
  tokenHash: text("token_hash").notNull(),
  generation: integer("generation").notNull().default(0),
  status: text("status").notNull().default("waiting"),
  offerSdp: text("offer_sdp"),
  answerSdp: text("answer_sdp"),
  offlineAt: integer("offline_at"),
  createdAt: integer("created_at").notNull(),
}, table => [uniqueIndex("room_members_room_slot_unique").on(table.roomCode, table.slot).where(sql`${table.status} <> 'removed'`)]);

// Mission receipts deliberately do not reference rooms: leaving/deleting a room
// must not destroy a player's pending reward.
export const missions = sqliteTable("missions", {
  id: text("id").primaryKey(),
  roomCode: text("room_code").notNull(),
  difficulty: text("difficulty").notNull(),
  reportTokenHash: text("report_token_hash").notNull(),
  registrationHash: text("registration_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("missions_expiry_idx").on(table.expiresAt)]);

export const missionReceipts = sqliteTable("mission_receipts", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull(),
  name: text("name").notNull(),
  claimTokenHash: text("claim_token_hash").notNull(),
  outcome: text("outcome"),
  hunter: integer("hunter").notNull().default(0),
  monster: integer("monster").notNull().default(0),
  heavy: integer("heavy").notNull().default(0),
  amount: integer("amount").notNull().default(0),
  completedAt: integer("completed_at"),
  expiresAt: integer("expires_at").notNull(),
}, table => [
  uniqueIndex("mission_receipts_player_unique").on(table.missionId, table.playerId),
  index("mission_receipts_expiry_idx").on(table.expiresAt),
]);
