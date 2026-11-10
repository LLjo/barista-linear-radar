import { describe, expect, spyOn, test } from "bun:test";
import type { BusEventInput } from "@barista/plugin-sdk";
import radar from "./fixtures/radar.json";
import { onWatchesChanged, radarBus, type PollBus } from "./bus.js";
import { EVENT_ID, MENTION_EVENT_ID, PR_EVENT_ID } from "./events.js";
import { mapRadar } from "./map.js";
import { createPoller, type PollerDeps } from "./poll-loop.js";
import type { RadarData } from "./query.js";
import { buildSnapshot } from "./snapshot.js";
import type { WorkspaceRecord } from "./types.js";
import type { FirstSeen } from "./workspaces.js";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const NEW = "2026-11-03T10:00:00.000Z";
const data = radar.data as unknown as RadarData;
const ws = (id: string, over: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  id, name: id, urlKey: id, viewerId: "user-me", viewerName: "Alex Doe", keyLast4: "abcd",
  status: "ok", addedAt: "2026-11-01T00:00:00.000Z", checkedAt: null, polledAt: null, ...over,
});

/** A fake SDK handle: records every call, with the watch generation a test can bump. */
function fakeHandle() {
  const calls: (["sync", string, string[]] | ["markReady", number] | ["readToken", number])[] = [];
  const prSyncs: [string, string[]][] = [];
  const mentionSyncs: [string, string[]][] = [];
  let gen = 0;
  return {
    calls,
    prSyncs,
    mentionSyncs,
    bump: () => ++gen,
    handle: {
      sync(event: string, scope: string, events: BusEventInput[]) {
        expect([EVENT_ID, PR_EVENT_ID, MENTION_EVENT_ID]).toContain(event);
        if (event === EVENT_ID) calls.push(["sync", scope, events.map((e) => e.key)]);
        else if (event === PR_EVENT_ID) prSyncs.push([scope, events.map((e) => e.key)]);
        else mentionSyncs.push([scope, events.map((e) => e.key)]);
        return [];
      },
      readToken() {
        calls.push(["readToken", gen]);
        return gen;
      },
      markReady(token?: number) {
        calls.push(["markReady", token ?? -1]);
        return true;
      },
    },
  };
}

/** First-seen rows: every issue initial except the ones named fresh. */
const seenFn = (fresh: string[]) => (ids: string[]) =>
  new Map<string, FirstSeen>(ids.map((id) => [id, { workspaceId: "a", at: NEW, initial: !fresh.includes(id) }]));

describe("radarBus", () => {
  const lists = mapRadar(data, { id: "a", name: "a", urlKey: "a" }, NOW);
  const snap = (w: WorkspaceRecord[], good = true) =>
    buildSnapshot(w, new Map(w.map((x) => [x.id, { good, lists }])), { fetchedAt: null, booted: true, now: NOW });

  test("syncs each good workspace under its id, then marks ready with the poll's token", () => {
    const f = fakeHandle();
    const b = radarBus(f.handle, seenFn(["iss-c1"]));
    b.polled([{ w: ws("a"), lists }], snap([ws("a")]), 7);
    expect(f.calls).toEqual([["sync", "a", ["iss-c1"]], ["markReady", 7]]);
    expect(f.prSyncs).toEqual([["a", ["iss-a2"]]]);
  });

  test("a workspace not polled ok this time: its siblings still sync, nothing is marked ready", () => {
    const f = fakeHandle();
    const b = radarBus(f.handle, seenFn([]));
    b.polled([{ w: ws("a"), lists }], snap([ws("a"), ws("b", { status: "rejected" })]), 3);
    expect(f.calls).toEqual([["sync", "a", []]]);
  });

  test("a watch change re-readies at once with a fresh token, only when the last poll was all ok", () => {
    const f = fakeHandle();
    f.bump();
    onWatchesChanged(f.handle, snap([ws("a")]));
    expect(f.calls).toEqual([["readToken", 1], ["markReady", 1]]);
    const g = fakeHandle();
    onWatchesChanged(g.handle, snap([ws("a", { status: "rejected" })]));
    expect(g.calls).toEqual([]);
  });

  test("forget tombstones the workspace's scope", () => {
    const f = fakeHandle();
    radarBus(f.handle, seenFn([])).forget("a");
    expect(f.calls).toEqual([["sync", "a", []]]);
    expect(f.prSyncs).toEqual([["a", []]]);
  });
});

describe("the poll loop feeds the bus", () => {
  function deps(rows: WorkspaceRecord[], fetchRadar: PollerDeps["fetchRadar"]): PollerDeps {
    return {
      listWorkspaces: () => rows,
      getKey: (id) => `key-${id}`,
      fetchRadar,
      fetchTeams: async () => [],
      recordPoll: (w, _l, at) => {
        rows.find((r) => r.id === w.id)!.polledAt ??= at;
        return true;
      },
      setRejected: () => {},
      getSettings: () => ({ refreshSec: 300 }),
      changed: () => {},
      now: () => NOW,
      setTimer: (() => ({ unref() {} })) as unknown as PollerDeps["setTimer"],
    };
  }

  test("the token is read BEFORE Linear is; a watch change mid-poll does not ride on it", async () => {
    const f = fakeHandle();
    const p = createPoller(deps([ws("a")], async () => {
      f.bump(); // a listener's watch changed while the request was out
      return data;
    }));
    p.attachBus(radarBus(f.handle, seenFn(["iss-c1"])));
    await p.poll();
    expect(f.calls).toEqual([["readToken", 0], ["sync", "a", ["iss-c1"]], ["markReady", 0]]);
    // The next poll is planned after the change: its token covers it.
    await p.poll();
    expect(f.calls.at(-1)).toEqual(["markReady", 1]);
  });

  test("a failed read: no sync, no markReady", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeHandle();
    const p = createPoller(deps([ws("a")], async () => { throw new Error("boom"); }));
    p.attachBus(radarBus(f.handle, seenFn([])));
    await p.poll();
    expect(f.calls).toEqual([["readToken", 0]]);
    warn.mockRestore();
  });

  test("a bus that throws does not fail the poll the page reads", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const p = createPoller(deps([ws("a")], async () => data));
    const broken: PollBus = { readToken: () => 0, polled: () => { throw new Error("disk full"); }, forget: () => {} };
    p.attachBus(broken);
    expect((await p.poll()).assigned.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("forget reaches the bus", () => {
    const f = fakeHandle();
    const p = createPoller(deps([ws("a")], async () => data));
    p.attachBus(radarBus(f.handle, seenFn([])));
    p.forget("a");
    expect(f.calls).toEqual([["sync", "a", []]]);
  });
});
