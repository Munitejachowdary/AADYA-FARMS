declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    LEDGER_ALLOWED_EMAILS?: string;
    BUCKET?: R2Bucket;
  }
}
