export const REFRESH_CHOICES = [60, 300, 900] as const;
export type RefreshSec = (typeof REFRESH_CHOICES)[number];

/** The longest skip pattern a setting holds. */
export const SKIP_PATTERN_MAX = 200;

export interface Settings {
  refreshSec: RefreshSec;
  /** A regex (case-insensitive) on a delegate comment's text: a match never fires delegate-replied. "" = skip none. */
  skipDelegateComments: string;
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
  /** The agent's name, "" when not delegated. */
  delegate: string;
  /** GitHub pull requests linked to the issue, canonical URLs. */
  prs: string[];
  createdAt: string;
  updatedAt: string;
  unseen: boolean;
  /** Mentions list only. */
  why?: Why;
  by?: string;
  /** Kept server-side for the event's brief; not shown by the UI. */
  description?: string;
  assigneeName?: string;
  creatorName?: string;
}

/** One @mention of me: an issue description or a comment, whatever state the issue is in. */
export interface MentionNote {
  /** Linear's notification id: one event per mention. */
  id: string;
  kind: "issue" | "comment";
  /** Who mentioned me, "" when Linear doesn't say. */
  by: string;
  at: string;
  issue: IssueRow;
  comment?: { body: string; url: string };
}

/** A comment the issue's delegate (an agent) posted on an issue assigned to me: top level or a thread reply. */
export interface DelegateComment {
  /** Linear's comment id: one event per comment. */
  id: string;
  /** The delegate's name. */
  author: string;
  at: string;
  body: string;
  url: string;
  /** The comment it replies to, when it is a thread reply. */
  parent?: { author: string; body: string };
  issue: IssueRow;
}

export interface Lists {
  assigned: IssueRow[];
  mentions: IssueRow[];
  created: IssueRow[];
  more: Record<ListId, boolean>;
  /** Every @mention notification in the page, newest first (the mention event's source). */
  mentionNotes?: MentionNote[];
  /** Comments by the delegate on my delegated issues, newest first (the delegate-replied event's source). */
  delegateComments?: DelegateComment[];
  /** A full page of notifications came back (first_seen only, see `isCut`). */
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
