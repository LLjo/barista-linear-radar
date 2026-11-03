import { db } from "./db.js";
import { REFRESH_CHOICES, type RefreshSec, type Settings } from "./types.js";

export const DEFAULT_SETTINGS: Settings = { refreshSec: 300 };

export function getSettings(): Settings {
  const row = db.get<{ refresh_sec: number }>("SELECT refresh_sec FROM linear_radar_settings WHERE id = 1");
  const ok = row && (REFRESH_CHOICES as readonly number[]).includes(row.refresh_sec);
  return ok ? { refreshSec: row.refresh_sec as RefreshSec } : { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): Settings {
  db.run(
    `INSERT INTO linear_radar_settings (id, refresh_sec, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET refresh_sec = excluded.refresh_sec, updated_at = excluded.updated_at`,
    [s.refreshSec, new Date().toISOString()],
  );
  return { refreshSec: s.refreshSec };
}
