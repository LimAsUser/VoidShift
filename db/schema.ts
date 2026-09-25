import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
});

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
