export const REFRESH_CHOICES = [60, 300, 900] as const;
export type RefreshSec = (typeof REFRESH_CHOICES)[number];

export interface Settings {
  refreshSec: RefreshSec;
}

export type ListId = "assigned" | "mentions" | "created";
export const LIST_IDS: readonly ListId[] = ["assigned", "mentions", "created"];

export type WorkspaceStatus = "ok" | "rejected";

/** A workspace as every route answers it: there is no key field here at all, only its last 4. */
export interface WorkspacePublic {
  id: string;
  name: string;
  urlKey: string;
  viewerName: string;
  keyLast4: string;
  status: WorkspaceStatus;
  addedAt: string;
  checkedAt: string | null;
  /** The last poll of this workspace failed (not a rejected key: that is `status`). */
  lastError?: string;
  /** Rate limited: no request to Linear before this time. */
  pausedUntil?: string;
}

/** A workspace row without its key; every query here names its columns (the key is keys.ts's). */
export interface WorkspaceRecord {
  id: string;
  name: string;
  urlKey: string;
  viewerId: string;
  viewerName: string;
  keyLast4: string;
  status: WorkspaceStatus;
  addedAt: string;
  checkedAt: string | null;
  /** The first good poll; null = the next good poll is the first (its issues are `initial`). */
  polledAt: string | null;
}

export interface SettingsReply extends Settings {
  workspaces: WorkspacePublic[];
}

export type Priority = 0 | 1 | 2 | 3 | 4;
export type Why = "mention" | "comment-mention" | "subscribed";

export interface IssueRow {
  id: string;
  identifier: string;
  title: string;
  /** issue.url from Linear. */
  url: string;
  workspace: { id: string; name: string; urlKey: string };
  team: { key: string; name: string };
  priority: Priority;
  state: { name: string; type: string };
  cycle: { number: number; active: boolean } | null;
  project: string | null;
  labels: string[];
  assignee: "me" | "someone else" | "unassigned";
  createdAt: string;
  updatedAt: string;
  unseen: boolean;
  /** Mentions list only. */
  why?: Why;
  by?: string;
  /** Kept server-side for the trigger's start body; not shown by the UI. */
  description?: string;
  assigneeName?: string;
  creatorName?: string;
}

export interface Lists {
  assigned: IssueRow[];
  mentions: IssueRow[];
  created: IssueRow[];
  more: Record<ListId, boolean>;
  /** Linear sent a full page of notifications: older mentions may be behind it (not shown, only for first_seen). */
  notificationsCut?: boolean;
}

export interface Team {
  workspaceId: string;
  key: string;
  name: string;
}

export interface Snapshot {
  /** The last poll where at least one workspace succeeded. */
  fetchedAt: string | null;
  /** False until every workspace has had one good poll. */
  ready: boolean;
  workspaces: WorkspacePublic[];
  teams: Team[];
  assigned: IssueRow[];
  mentions: IssueRow[];
  created: IssueRow[];
  more: Record<ListId, boolean>;
  /** Across all three lists, before client filters. */
  unseen: number;
}

export type LinearErrorKind = "auth" | "rate" | "http" | "graphql" | "network";
