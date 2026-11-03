import { describe, expect, spyOn, test } from "bun:test";
import radar from "./fixtures/radar.json";
import teams from "./fixtures/teams.json";
import { LinearError } from "./linear.js";
import { createPoller, type PollerDeps } from "./poll-loop.js";
import type { RadarData } from "./query.js";
import { seenEntries } from "./snapshot.js";
import type { WorkspaceRecord } from "./types.js";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const data = radar.data as unknown as RadarData;
const ws = (id: string, over: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  id, name: id, urlKey: id, viewerId: "user-me", viewerName: "Alex Doe", keyLast4: "abcd",
  status: "ok", addedAt: "2026-11-01T00:00:00.000Z", checkedAt: null, polledAt: null, ...over,
});

/** A fake world: workspaces in memory, a scripted Linear per key. */
function world(rows: WorkspaceRecord[], linear: Record<string, () => Promise<RadarData>>) {
  const seen: { ws: string; ids: string[]; initial: boolean }[] = [];
  const calls: string[] = [];
  let timers = 0;
  const deps: PollerDeps = {
    listWorkspaces: () => rows,
    getKey: (id) => `key-${id}`,
    fetchRadar: (key) => {
      calls.push(key);
      return linear[key.slice(4)]();
    },
    fetchTeams: async () => teams.data.teams.nodes,
    recordPoll: (w, lists, at) => {
      const row = rows.find((r) => r.id === w.id && r.addedAt === w.addedAt && r.viewerId === w.viewerId);
      if (!row) return false;
      const entries = seenEntries(lists, row.polledAt, false);
      seen.push({ ws: w.id, ids: entries.map((e) => e.id), initial: entries.every((e) => e.initial) });
      row.status = "ok";
      row.polledAt ??= at;
      return true;
    },
    setRejected: (id) => {
      rows.find((r) => r.id === id)!.status = "rejected";
    },
    getSettings: () => ({ refreshSec: 300 }),
    changed: () => {},
    now: () => NOW,
    setTimer: (() => {
      timers++;
      return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
    }) as PollerDeps["setTimer"],
  };
  return { deps, seen, calls, timers: () => timers };
}

const ok = async () => data;
const quiet = () => spyOn(console, "warn").mockImplementation(() => {});

describe("poll loop", () => {
  test("not ready before the first poll; ready after every workspace had a good one", async () => {
    const w = world([ws("a")], { a: ok });
    const p = createPoller(w.deps);
    expect(p.getSnapshot().ready).toBe(false);
    const s = await p.poll();
    expect(s.ready).toBe(true);
    expect(s.assigned.length).toBe(3);
    expect(s.unseen).toBe(3);
    expect(s.teams.map((t) => t.key)).toEqual(["ENG", "WEB", "DES"]);
  });

  test("the workspace's first good poll records its issues as initial, later ones not", async () => {
    const w = world([ws("a")], { a: ok });
    const p = createPoller(w.deps);
    await p.poll();
    await p.poll();
    expect(w.seen.map((s) => s.initial)).toEqual([true, false]);
    expect(w.seen[0].ids.length).toBe(8);
  });

  test("a workspace already polled before a restart is not initial again", async () => {
    const w = world([ws("a", { polledAt: "2026-11-02T00:00:00.000Z" })], { a: ok });
    await createPoller(w.deps).poll();
    expect(w.seen[0].initial).toBe(false);
  });

  test("a failure keeps the last good lists and shows the error", async () => {
    let fail = false;
    const w = world([ws("a")], { a: async () => (fail ? Promise.reject(new LinearError("network", 0, "Could not reach Linear")) : data) });
    const p = createPoller(w.deps);
    await p.poll();
    fail = true;
    const warn = quiet();
    const s = await p.poll();
    warn.mockRestore();
    expect(s.assigned.length).toBe(3);
    expect(s.workspaces[0].lastError).toBe("Could not reach Linear");
    expect(s.ready).toBe(true);
  });

  test("one failing workspace does not stop the other", async () => {
    const w = world([ws("a"), ws("b")], { a: ok, b: () => Promise.reject(new LinearError("http", 500, "boom")) });
    const warn = quiet();
    const s = await createPoller(w.deps).poll();
    warn.mockRestore();
    expect(s.assigned.length).toBe(3);
    expect(s.ready).toBe(false);
    expect(s.fetchedAt).not.toBeNull();
  });

  test("auth marks the workspace rejected", async () => {
    const w = world([ws("a")], { a: () => Promise.reject(new LinearError("auth", 401, "Authentication required")) });
    const warn = quiet();
    const s = await createPoller(w.deps).poll();
    warn.mockRestore();
    expect(s.workspaces[0].status).toBe("rejected");
    expect(s.workspaces[0].lastError).toBeUndefined();
  });

  test("rate limited: paused until the reset, no request meanwhile, timer set to the reset", async () => {
    const w = world([ws("a")], { a: () => Promise.reject(new LinearError("rate", 429, "slow down", NOW + 90_000)) });
    const warn = quiet();
    const p = createPoller(w.deps);
    const s = await p.poll();
    await p.poll();
    warn.mockRestore();
    expect(w.calls.length).toBe(1);
    expect(s.workspaces[0].pausedUntil).toBe(new Date(NOW + 90_000).toISOString());
  });

  test("a poll while one runs joins it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = world([ws("a")], { a: async () => (await gate, data) });
    const p = createPoller(w.deps);
    const one = p.poll();
    const two = p.poll();
    release();
    expect(await one).toBe(await two);
    expect(w.calls.length).toBe(1);
  });

  test("a removed workspace drops out of the snapshot at once", async () => {
    const rows = [ws("a")];
    const w = world(rows, { a: ok });
    const p = createPoller(w.deps);
    await p.poll();
    rows.pop();
    p.forget("a");
    expect(p.getSnapshot().assigned).toEqual([]);
    expect(p.getSnapshot().workspaces).toEqual([]);
  });
});
