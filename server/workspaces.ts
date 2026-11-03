import { db } from "./db.js";
import { isCut, seenEntries } from "./snapshot.js";
import type { Lists, WorkspaceRecord, WorkspaceStatus } from "./types.js";

export type { WorkspaceRecord };

interface Row {
  id: string; name: string; url_key: string; viewer_id: string; viewer_name: string;
  key_last4: string; status: string; added_at: string; checked_at: string | null; polled_at: string | null;
}

const COLUMNS = "id, name, url_key, viewer_id, viewer_name, key_last4, status, added_at, checked_at, polled_at";

const fromRow = (r: Row): WorkspaceRecord => ({
  id: r.id, name: r.name, urlKey: r.url_key, viewerId: r.viewer_id, viewerName: r.viewer_name,
  keyLast4: r.key_last4, status: r.status === "rejected" ? "rejected" : "ok",
  addedAt: r.added_at, checkedAt: r.checked_at, polledAt: r.polled_at,
});

export function listWorkspaces(): WorkspaceRecord[] {
  return db.query<Row>(`SELECT ${COLUMNS} FROM linear_radar_workspaces ORDER BY added_at, id`).map(fromRow);
}

export function getWorkspace(id: string): WorkspaceRecord | null {
  const r = db.get<Row>(`SELECT ${COLUMNS} FROM linear_radar_workspaces WHERE id = ?`, [id]);
  return r ? fromRow(r) : null;
}

export function setStatus(id: string, status: WorkspaceStatus, now: string): void {
  db.run("UPDATE linear_radar_workspaces SET status = ?, checked_at = ? WHERE id = ?", [status, now, id]);
}

export interface FirstSeen {
  workspaceId: string;
  at: string;
  initial: boolean;
}

/**
 * Fold one good poll into first_seen and mark the workspace polled — only while the row is still the
 * workspace and the person the poll started for. A Remove, a re-add or another person's key during
 * the request (up to 20 s) makes this poll stale: it records nothing and answers false.
 */
export function recordPoll(w: WorkspaceRecord, lists: Lists, now: string): boolean {
  return db.transaction(() => {
    const row = db.get<{ polled_at: string | null; cut: number }>(
      "SELECT polled_at, cut FROM linear_radar_workspaces WHERE id = ? AND added_at = ? AND viewer_id = ?",
      [w.id, w.addedAt, w.viewerId],
    );
    if (!row) return false;
    const cut = row.cut === 1 || isCut(lists);
    for (const e of seenEntries(lists, row.polled_at, cut)) {
      if (!row.polled_at) {
        // The first poll wins over any row left behind: what stands now never fires.
        db.run(
          `INSERT INTO linear_radar_first_seen (issue_id, workspace_id, first_seen_at, initial) VALUES (?, ?, ?, 1)
           ON CONFLICT(issue_id) DO UPDATE SET initial = 1`,
          [e.id, w.id, now],
        );
      } else {
        db.run(
          "INSERT OR IGNORE INTO linear_radar_first_seen (issue_id, workspace_id, first_seen_at, initial) VALUES (?, ?, ?, ?)",
          [e.id, w.id, now, e.initial ? 1 : 0],
        );
      }
    }
    db.run(
      "UPDATE linear_radar_workspaces SET status = 'ok', checked_at = ?, polled_at = COALESCE(polled_at, ?), cut = ? WHERE id = ?",
      [now, now, cut ? 1 : 0, w.id],
    );
    return true;
  });
}

export function firstSeen(): Map<string, FirstSeen> {
  const rows = db.query<{ issue_id: string; workspace_id: string; first_seen_at: string; initial: number }>(
    "SELECT issue_id, workspace_id, first_seen_at, initial FROM linear_radar_first_seen",
  );
  return new Map(rows.map((r) => [r.issue_id, { workspaceId: r.workspace_id, at: r.first_seen_at, initial: r.initial === 1 }]));
}
