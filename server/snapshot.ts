import { byUnseenThenUpdated } from "./map.js";
import type { IssueRow, LinearErrorKind, Lists, Snapshot, Team, WorkspacePublic, WorkspaceRecord } from "./types.js";

/** What the poller knows about one workspace since boot (memory only). */
export interface Live {
  /** The last good lists; kept through later failures. */
  lists?: Lists;
  /** Had at least one good poll since boot. */
  good: boolean;
  error?: LinearErrorKind;
  lastError?: string;
  /** Rate limited: epoch ms. */
  pausedUntil?: number;
  teams?: Team[];
  teamsAt?: number;
}

/** The first poll after boot failing waits this long, not a whole interval, before trying again. */
export const BOOT_RETRY_MS = 30_000;

/** The shape every route answers: no key, no viewer id. */
export function toPublic(w: WorkspaceRecord, live?: { lastError?: string; pausedUntil?: string }): WorkspacePublic {
  const p: WorkspacePublic = {
    id: w.id, name: w.name, urlKey: w.urlKey, viewerName: w.viewerName, keyLast4: w.keyLast4,
    status: w.status, addedAt: w.addedAt, checkedAt: w.checkedAt,
  };
  if (live?.lastError) p.lastError = live.lastError;
  if (live?.pausedUntil) p.pausedUntil = live.pausedUntil;
  return p;
}

/** Fold every workspace's live state into the one snapshot the routes answer. */
export function buildSnapshot(
  workspaces: WorkspaceRecord[],
  live: Map<string, Live>,
  meta: { fetchedAt: string | null; booted: boolean; now: number },
): Snapshot {
  const lists = { assigned: [] as IssueRow[], mentions: [] as IssueRow[], created: [] as IssueRow[] };
  const more = { assigned: false, mentions: false, created: false };
  const teams: Team[] = [];
  for (const w of workspaces) {
    const l = live.get(w.id);
    if (l?.teams) teams.push(...l.teams);
    if (!l?.lists) continue;
    for (const k of ["assigned", "mentions", "created"] as const) {
      lists[k].push(...l.lists[k]);
      more[k] ||= l.lists.more[k];
    }
  }
  for (const k of ["assigned", "mentions", "created"] as const) lists[k].sort(byUnseenThenUpdated);
  const pub = workspaces.map((w) => {
    const l = live.get(w.id);
    const paused = l?.pausedUntil && l.pausedUntil > meta.now ? new Date(l.pausedUntil).toISOString() : undefined;
    return toPublic(w, { lastError: l?.error && l.error !== "auth" ? l.lastError : undefined, pausedUntil: paused });
  });
  const unseen = [...lists.assigned, ...lists.mentions, ...lists.created].filter((r) => r.unseen).length;
  return {
    fetchedAt: meta.fetchedAt,
    ready: meta.booted && workspaces.every((w) => live.get(w.id)?.good),
    workspaces: pub,
    teams,
    ...lists,
    more,
    unseen,
  };
}

/** Wait before the next poll: the interval, the end of the soonest rate-limit pause, or a quick boot retry (not for a rejected key). */
export function nextDelayMs(workspaces: WorkspaceRecord[], live: Map<string, Live>, refreshSec: number, now: number): number {
  let delay = refreshSec * 1000;
  for (const w of workspaces) {
    const l = live.get(w.id);
    if (l?.pausedUntil && l.pausedUntil > now) delay = Math.min(delay, l.pausedUntil - now);
    // A rejected key waits for Replace; it never speeds the loop up.
    else if (!l?.good && w.status !== "rejected") delay = Math.min(delay, BOOT_RETRY_MS);
  }
  return delay;
}

/**
 * How each listed issue is recorded in first_seen. On the workspace's first poll everything is
 * `initial`: old news, never an event. After that, an issue new to us is an event — unless Linear
 * has ever cut one of this workspace's lists at 50 or its notifications at 100 (`cut`). Then an issue we had not seen may simply
 * have been past the cut all along, so one created before the first poll stays `initial`: "new only"
 * errs on the side of starting nothing.
 */
export function seenEntries(lists: Lists, polledAt: string | null, cut: boolean): { id: string; initial: boolean }[] {
  const out: { id: string; initial: boolean }[] = [];
  for (const k of ["assigned", "mentions", "created"] as const) {
    for (const r of lists[k]) {
      out.push({ id: r.id, initial: !polledAt || (cut && Date.parse(r.createdAt) < Date.parse(polledAt)) });
    }
  }
  return out;
}

/** Linear sent fewer than it has in at least one list, or a full page of notifications (older mentions behind it). */
export const isCut = (l: Lists) => l.more.assigned || l.more.mentions || l.more.created || !!l.notificationsCut;
