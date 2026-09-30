declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET?: R2Bucket;
    VOIDSHIFT_TURN_USERNAME?: string;
    VOIDSHIFT_TURN_PASSWORD?: string;
  }
}
