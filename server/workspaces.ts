import { db } from "./db.js";
import type { WorkspaceRecord, WorkspaceStatus } from "./types.js";

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

export function markPolled(id: string, now: string): void {
  db.run("UPDATE linear_radar_workspaces SET status = 'ok', checked_at = ?, polled_at = COALESCE(polled_at, ?) WHERE id = ?", [now, now, id]);
}

export interface FirstSeen {
  workspaceId: string;
  at: string;
  initial: boolean;
}

/** Record when each issue was first seen. `initial` = from its workspace's first poll: never an event. */
export function recordSeen(workspaceId: string, issueIds: string[], initial: boolean, now: string): void {
  db.transaction(() => {
    for (const id of issueIds) {
      db.run(
        "INSERT OR IGNORE INTO linear_radar_first_seen (issue_id, workspace_id, first_seen_at, initial) VALUES (?, ?, ?, ?)",
        [id, workspaceId, now, initial ? 1 : 0],
      );
    }
  });
}

export function firstSeen(): Map<string, FirstSeen> {
  const rows = db.query<{ issue_id: string; workspace_id: string; first_seen_at: string; initial: number }>(
    "SELECT issue_id, workspace_id, first_seen_at, initial FROM linear_radar_first_seen",
  );
  return new Map(rows.map((r) => [r.issue_id, { workspaceId: r.workspace_id, at: r.first_seen_at, initial: r.initial === 1 }]));
}
