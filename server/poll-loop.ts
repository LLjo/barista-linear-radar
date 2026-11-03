import { LinearError } from "./linear.js";
import { mapRadar } from "./map.js";
import type { RadarData } from "./query.js";
import { buildSnapshot, nextDelayMs, type Live } from "./snapshot.js";
import type { Lists, Settings, Snapshot, Team, WorkspaceRecord } from "./types.js";

/** The team list is a rare query: on a key add (a new workspace) and once a day. */
export const TEAMS_EVERY_MS = 24 * 60 * 60_000;
const FALLBACK_DELAY_MS = 300_000;

/** Everything the poll loop touches outside itself; poller.ts wires the real ones. */
export interface PollerDeps {
  listWorkspaces: () => WorkspaceRecord[];
  getKey: (workspaceId: string) => string | null;
  fetchRadar: (key: string) => Promise<RadarData>;
  fetchTeams: (key: string) => Promise<{ id: string; key: string; name: string }[]>;
  /** Record first-seen rows and mark it polled; false = the workspace changed under the poll (stale). */
  recordPoll: (w: WorkspaceRecord, lists: Lists, now: string) => boolean;
  /** Mark the key rejected — only while it is still the key the poll used. */
  setRejected: (w: WorkspaceRecord, now: string) => void;
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
  let stopped = false;

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
    // A rejected key is not sent again until it is replaced (Replace sets the status back to ok).
    if (w.status === "rejected") return false;
    const key = deps.getKey(w.id);
    if (!key) return false;
    try {
      const data = await deps.fetchRadar(key);
      const at = new Date(now()).toISOString();
      const lists = mapRadar(data, { id: w.id, name: w.name, urlKey: w.urlKey }, now());
      if (!deps.recordPoll(w, lists, at)) return false;
      Object.assign(l, { lists, good: true, error: undefined, lastError: undefined, pausedUntil: undefined });
      await teamsFor(w, key, l);
      return true;
    } catch (e) {
      const err = e instanceof LinearError ? e : new LinearError("http", 0, "Unexpected error reading Linear");
      l.error = err.kind;
      l.lastError = err.kind === "rate" ? "Rate limited by Linear" : err.message;
      if (err.kind === "rate") l.pausedUntil = err.retryAt;
      if (err.kind === "auth") deps.setRejected(w, new Date(now()).toISOString());
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

  /** The next wait; a failure reading it falls back to the default interval rather than ending the loop. */
  function delay(): number {
    try {
      return nextDelayMs(deps.listWorkspaces(), live, deps.getSettings().refreshSec, now());
    } catch {
      return FALLBACK_DELAY_MS;
    }
  }

  /** Poll, never rejecting: a failed poll is logged and the loop goes on. */
  async function safePoll(): Promise<void> {
    try {
      await poll();
    } catch (e) {
      console.warn("[linear-radar] poll failed:", e instanceof Error ? e.message : "unexpected error");
    }
  }

  function schedule(delayMs?: number): void {
    // After stop() (shutdown), an in-flight poll must not re-arm the timer against a closed DB.
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimer(async () => {
      await safePoll();
      schedule();
    }, delayMs ?? delay());
    timer.unref?.();
  }

  /** A settings change or an added key: poll with it now, then re-arm the timer. Never rejects. */
  function refreshNow(): void {
    void pollFresh()
      .catch((e) => console.warn("[linear-radar] poll failed:", e instanceof Error ? e.message : "unexpected error"))
      .then(() => schedule());
  }

  /** Built on read: a removed or added workspace shows at once, not at the next poll. */
  function getSnapshot(): Snapshot {
    return buildSnapshot(deps.listWorkspaces(), live, { fetchedAt, booted, now: now() });
  }

  return {
    getSnapshot,
    poll,
    pollFresh,
    refreshNow,
    schedule,
    /** Tell the UI the snapshot changed without polling (a removed workspace). */
    changed: () => deps.changed(),
    /** A removed workspace: forget its lists now. */
    forget(id: string): void {
      live.delete(id);
    },
    async start(): Promise<void> {
      await safePoll();
      schedule();
    },
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
