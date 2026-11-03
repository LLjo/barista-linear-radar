import { openStorage, type Storage } from "@barista/plugin-sdk/sqlite";
import { chmodSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.PLUGIN_DATA_DIR
  ? join(process.env.PLUGIN_DATA_DIR, "linear-radar")
  : join(import.meta.dirname, "..", "data");

export const db: Storage = await openStorage({ dir: DATA_DIR, name: "linear-radar" });
// The file holds API keys: owner-only. The host is the trust boundary (no encryption at rest).
for (const p of [db.path, `${db.path}-wal`, `${db.path}-shm`]) {
  try {
    chmodSync(p, 0o600);
  } catch {
    // -wal / -shm may not exist yet
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS linear_radar_workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, url_key TEXT NOT NULL,
    viewer_id TEXT NOT NULL, viewer_name TEXT NOT NULL,
    api_key TEXT NOT NULL, key_last4 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    added_at TEXT NOT NULL, checked_at TEXT,
    polled_at TEXT,
    cut INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS linear_radar_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    refresh_sec INTEGER NOT NULL DEFAULT 300, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS linear_radar_first_seen (
    issue_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    initial INTEGER NOT NULL DEFAULT 0
  );
`);

/** Checkpoint the WAL and close — registered with `registerShutdown` in index.ts. */
export function closeDb(): void {
  db.close();
}
