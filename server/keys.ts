import { db } from "./db.js";

/**
 * The ONLY module that reads the `api_key` column. Every other query names its columns, and
 * nothing it returns leaves the server: the routes answer `WorkspacePublic`, which has no key.
 */
export function getKey(workspaceId: string): string | null {
  return db.get<{ api_key: string }>("SELECT api_key FROM linear_radar_workspaces WHERE id = ?", [workspaceId])?.api_key ?? null;
}

export const last4 = (key: string) => key.slice(-4);

export interface NewWorkspace {
  id: string;
  name: string;
  urlKey: string;
  viewerId: string;
  viewerName: string;
}

/**
 * Upsert by organization id: a second key for the same workspace replaces the first. A key of
 * ANOTHER person in it starts over: their lists are not ours, so their next poll is a first poll
 * (`polled_at` NULL), whose issues never fire. Answers whether the person changed.
 */
export function addKey(w: NewWorkspace, key: string, now = new Date().toISOString()): { viewerChanged: boolean } {
  const before = db.get<{ viewer_id: string }>("SELECT viewer_id FROM linear_radar_workspaces WHERE id = ?", [w.id]);
  db.run(
    `INSERT INTO linear_radar_workspaces (id, name, url_key, viewer_id, viewer_name, api_key, key_last4, status, added_at, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, url_key = excluded.url_key, viewer_id = excluded.viewer_id,
       viewer_name = excluded.viewer_name, api_key = excluded.api_key, key_last4 = excluded.key_last4,
       status = 'ok', checked_at = excluded.checked_at,
       polled_at = CASE WHEN linear_radar_workspaces.viewer_id = excluded.viewer_id THEN linear_radar_workspaces.polled_at ELSE NULL END,
       cut = CASE WHEN linear_radar_workspaces.viewer_id = excluded.viewer_id THEN linear_radar_workspaces.cut ELSE 0 END`,
    [w.id, w.name, w.urlKey, w.viewerId, w.viewerName, key, last4(key), now, now],
  );
  return { viewerChanged: !!before && before.viewer_id !== w.viewerId };
}

/** Deletes the key and the workspace's first-seen rows. */
export function removeKey(workspaceId: string): boolean {
  return db.transaction(() => {
    db.run("DELETE FROM linear_radar_first_seen WHERE workspace_id = ?", [workspaceId]);
    return db.run("DELETE FROM linear_radar_workspaces WHERE id = ?", [workspaceId]).changes > 0;
  });
}
