import { env } from "cloudflare:workers";

const ROOM_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type RoomRecord = {
  code: string;
  host_token: string;
  offer_sdp: string;
  answer_sdp: string | null;
  claimed: number;
  created_at: number;
  expires_at: number;
};

export function getRoomDb() {
  if (!env.DB) throw new Error("Room database is unavailable");
  return env.DB;
}

export function createRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

export function createHostToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function roomExpiry(now = Date.now()) {
  return now + ROOM_TTL_MS;
}

export function validateSdp(value: unknown) {
  return typeof value === "string" && value.length > 20 && value.length <= 64_000;
}
