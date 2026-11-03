import { LinearError } from "./linear.js";
import { mapRadar } from "./map.js";
import type { RadarData } from "./query.js";
import { buildSnapshot, nextDelayMs, type Live } from "./snapshot.js";
import type { Settings, Snapshot, Team } from "./types.js";
import type { WorkspaceRecord } from "./types.js";

/** The team list is a rare query: on a key add (a new workspace) and once a day. */
export const TEAMS_EVERY_MS = 24 * 60 * 60_000;

/** Everything the poll loop touches outside itself; poller.ts wires the real ones. */
export interface PollerDeps {
  listWorkspaces: () => WorkspaceRecord[];
  getKey: (workspaceId: string) => string | null;
  fetchRadar: (key: string) => Promise<RadarData>;
  fetchTeams: (key: string) => Promise<{ id: string; key: string; name: string }[]>;
  markPolled: (workspaceId: string, now: string) => void;
  setRejected: (workspaceId: string, now: string) => void;
  recordSeen: (workspaceId: string, issueIds: string[], initial: boolean, now: string) => void;
  getSettings: () => Settings;
  /** Tell the UI the snapshot changed. */
  changed: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export function createPoller(deps: PollerDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? setTimeout;
  const live = new Map<string, Live>();
  let fetchedAt: string | null = null;
  let booted = false;
  let inFlight: Promise<Snapshot> | null = null;
  let rerun: Promise<Snapshot> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function teamsFor(w: WorkspaceRecord, key: string, l: Live): Promise<void> {
    if (l.teamsAt && now() - l.teamsAt < TEAMS_EVERY_MS) return;
    try {
      const nodes = await deps.fetchTeams(key);
      l.teams = nodes.map((t): Team => ({ workspaceId: w.id, key: t.key, name: t.name }));
      l.teamsAt = now();
    } catch (e) {
      // Teams only feed the filter list: keep the old ones and try again next poll.
      console.warn(`[linear-radar] ${w.urlKey}: teams not read:`, e instanceof LinearError ? `${e.kind} ${e.message}` : "unexpected error");
    }
  }

  /** One workspace, one request. Never throws: a failure keeps its last good lists. */
  async function pollWorkspace(w: WorkspaceRecord): Promise<boolean> {
    const l: Live = live.get(w.id) ?? { good: false };
    live.set(w.id, l);
    if (l.pausedUntil && l.pausedUntil > now()) return false;
    const key = deps.getKey(w.id);
    if (!key) return false;
    try {
      const data = await deps.fetchRadar(key);
      const at = new Date(now()).toISOString();
      const lists = mapRadar(data, { id: w.id, name: w.name, urlKey: w.urlKey }, now());
      const ids = [...lists.assigned, ...lists.mentions, ...lists.created].map((r) => r.id);
      // The workspace's first good poll ever: what stands now is old news, never an event.
      deps.recordSeen(w.id, ids, !w.polledAt, at);
      deps.markPolled(w.id, at);
      Object.assign(l, { lists, good: true, error: undefined, lastError: undefined, pausedUntil: undefined });
      await teamsFor(w, key, l);
      return true;
    } catch (e) {
      const err = e instanceof LinearError ? e : new LinearError("http", 0, "Unexpected error reading Linear");
      l.error = err.kind;
      l.lastError = err.kind === "rate" ? "Rate limited by Linear" : err.message;
      if (err.kind === "rate") l.pausedUntil = err.retryAt;
      if (err.kind === "auth") deps.setRejected(w.id, new Date(now()).toISOString());
      console.warn(`[linear-radar] ${w.urlKey}: ${err.kind} ${err.message}`);
      return false;
    }
  }

  async function fetchOnce(): Promise<Snapshot> {
    const workspaces = deps.listWorkspaces();
    for (const id of live.keys()) if (!workspaces.some((w) => w.id === id)) live.delete(id);
    // In parallel: every request has its own 20 s timeout, so one hung workspace stalls nobody.
    const results = await Promise.all(workspaces.map(pollWorkspace));
    if (results.some(Boolean)) fetchedAt = new Date(now()).toISOString();
    booted = true;
    // Re-read: a poll may have marked a workspace rejected or polled.
    return buildSnapshot(deps.listWorkspaces(), live, { fetchedAt, booted, now: now() });
  }

  /** Poll now. A call while a poll is running joins it rather than starting a second one. */
  function poll(): Promise<Snapshot> {
    inFlight ??= fetchOnce()
      .then((s) => {
        deps.changed();
        return s;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Poll with the workspaces as they are NOW: wait for a running poll, then poll once more. */
  function pollFresh(): Promise<Snapshot> {
    if (!inFlight) return poll();
    rerun ??= inFlight.catch(() => undefined).then(() => {
      rerun = null;
      return poll();
    });
    return rerun;
  }

  function schedule(delayMs = nextDelayMs(deps.listWorkspaces(), live, deps.getSettings().refreshSec, now())): void {
    if (timer) clearTimeout(timer);
    timer = setTimer(async () => {
      await poll();
      schedule();
    }, delayMs);
    timer.unref?.();
  }

  /** Built on read: a removed or added workspace shows at once, not at the next poll. */
  function getSnapshot(): Snapshot {
    return buildSnapshot(deps.listWorkspaces(), live, { fetchedAt, booted, now: now() });
  }

  return {
    getSnapshot,
    poll,
    pollFresh,
    schedule,
    /** A removed workspace: forget its lists now. */
    forget(id: string): void {
      live.delete(id);
    },
    async start(): Promise<void> {
      await poll();
      schedule();
    },
    stop(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
