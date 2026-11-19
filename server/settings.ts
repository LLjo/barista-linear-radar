import { db } from "./db.js";
import { REFRESH_CHOICES, SKIP_PATTERN_MAX, type RefreshSec, type Settings } from "./types.js";

export const DEFAULT_SETTINGS: Settings = { refreshSec: 300, skipDelegateComments: "" };

export function getSettings(): Settings {
  const row = db.get<{ refresh_sec: number; skip_delegate_comments: string | null }>(
    "SELECT refresh_sec, skip_delegate_comments FROM linear_radar_settings WHERE id = 1",
  );
  if (!row) return { ...DEFAULT_SETTINGS };
  const ok = (REFRESH_CHOICES as readonly number[]).includes(row.refresh_sec);
  return {
    refreshSec: ok ? (row.refresh_sec as RefreshSec) : DEFAULT_SETTINGS.refreshSec,
    skipDelegateComments: (row.skip_delegate_comments ?? "").slice(0, SKIP_PATTERN_MAX),
  };
}

/** Saves what is given; a setting left out keeps its stored value. */
export function saveSettings(patch: Partial<Settings>): Settings {
  const s: Settings = { ...getSettings(), ...patch };
  db.run(
    `INSERT INTO linear_radar_settings (id, refresh_sec, skip_delegate_comments, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET refresh_sec = excluded.refresh_sec, skip_delegate_comments = excluded.skip_delegate_comments,
       updated_at = excluded.updated_at`,
    [s.refreshSec, s.skipDelegateComments, new Date().toISOString()],
  );
  return s;
}
