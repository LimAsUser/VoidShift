import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  hostToken: text("host_token").notNull().default(""),
  offerSdp: text("offer_sdp").notNull(),
  answerSdp: text("answer_sdp"),
  claimed: integer("claimed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
