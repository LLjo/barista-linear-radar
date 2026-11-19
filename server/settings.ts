import { db } from "./db.js";
import { REFRESH_CHOICES, SKIP_PATTERN_MAX, type DelegateSkip, type RefreshSec, type Settings } from "./types.js";

export const DEFAULT_SETTINGS: Settings = { refreshSec: 300, skipDelegateComments: "" };

type Row = { refresh_sec: number; skip_delegate_comments: string | null; skip_changed_at: string | null };
const read = () => db.get<Row>("SELECT refresh_sec, skip_delegate_comments, skip_changed_at FROM linear_radar_settings WHERE id = 1");

export function getSettings(): Settings {
  const row = read();
  if (!row) return { ...DEFAULT_SETTINGS };
  const ok = (REFRESH_CHOICES as readonly number[]).includes(row.refresh_sec);
  return {
    refreshSec: ok ? (row.refresh_sec as RefreshSec) : DEFAULT_SETTINGS.refreshSec,
    skipDelegateComments: (row.skip_delegate_comments ?? "").slice(0, SKIP_PATTERN_MAX),
  };
}

/** The skip pattern and when it last changed, for the delegate-replied event. */
export function getDelegateSkip(): DelegateSkip {
  const row = read();
  return { pattern: (row?.skip_delegate_comments ?? "").slice(0, SKIP_PATTERN_MAX), since: row?.skip_changed_at ?? null };
}

/** Saves what is given; a setting left out keeps its stored value. A changed skip pattern records when it changed. */
export function saveSettings(patch: Partial<Settings>): Settings {
  const was = getSettings();
  const s: Settings = { ...was, ...patch };
  const now = new Date().toISOString();
  const changedAt = s.skipDelegateComments !== was.skipDelegateComments ? now : (read()?.skip_changed_at ?? null);
  db.run(
    `INSERT INTO linear_radar_settings (id, refresh_sec, skip_delegate_comments, skip_changed_at, updated_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET refresh_sec = excluded.refresh_sec, skip_delegate_comments = excluded.skip_delegate_comments,
       skip_changed_at = excluded.skip_changed_at, updated_at = excluded.updated_at`,
    [s.refreshSec, s.skipDelegateComments, changedAt, now],
  );
  return s;
}
