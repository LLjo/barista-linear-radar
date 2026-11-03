import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import radar from "./fixtures/radar.json";
import teams from "./fixtures/teams.json";
import viewer from "./fixtures/viewer.json";

// Invented keys: never real ones. The DB goes to a temp dir, set before db.ts is imported.
const KEY = "fake-linear-key-acme-0123456789abcdef";
const KEY2 = "fake-linear-key-acme-second-9876543210";
const BAD = "fake-linear-key-rejected-000000000000";
const OTHER = "fake-linear-key-acme-other-person-0000";
const dir = mkdtempSync(join(tmpdir(), "linear-radar-test-"));
process.env.PLUGIN_DATA_DIR = dir;

let radarStatus = 200;
/** Replaces the radar fixture when set. */
let radarBody: unknown = null;
const realFetch = globalThis.fetch;
const gqlError = (code: string, message: string) => ({ errors: [{ message, extensions: { code } }] });

/** A fake Linear: picks the answer from the query text and the key. */
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const key = (init.headers as Record<string, string>).Authorization;
  const { query } = JSON.parse(String(init.body)) as { query: string };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (key === BAD) return json(gqlError("AUTHENTICATION_ERROR", "Authentication required, not authenticated"), 401);
  if (query.includes("query Radar")) {
    return radarStatus === 200 ? json(radarBody ?? radar) : json(gqlError("AUTHENTICATION_ERROR", "Authentication required, not authenticated"), radarStatus);
  }
  if (query.includes("teams(")) return json(teams);
  if (key === OTHER) return json({ data: { viewer: { ...viewer.data.viewer, id: "user-other", name: "Kim Lee" } } });
  return json(viewer);
}) as unknown as typeof fetch;

const { default: app, triggerHandlers } = await import("./routes.js");
const { answerTriggerRequest } = await import("@barista/plugin-sdk/triggers");
const { poll } = await import("./poller.js");
const { db } = await import("./db.js");
const ws = await import("./workspaces.js");
const { mapRadar } = await import("./map.js");
const seenRows = () => db.query<{ issue_id: string; initial: number }>("SELECT issue_id, initial FROM linear_radar_first_seen ORDER BY issue_id");

const bodies: string[] = [];
const logs: unknown[][] = [];
const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
  spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args)),
);

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, text, json: () => JSON.parse(text) };
}
async function events(since?: string): Promise<any> {
  const answer = await answerTriggerRequest(triggerHandlers, { trigger: "new-issue-for-me", since: since ?? null });
  bodies.push(JSON.stringify(answer));
  return answer;
}

afterAll(() => {
  for (const s of spies) s.mockRestore();
  globalThis.fetch = realFetch;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("routes", () => {
  beforeAll(async () => {
    expect((await events()).error).toContain("not ready yet");
  });

  test("a rule polling before any workspace exists gets not ready, never [] (its baseline)", async () => {
    await poll();
    expect((await events()).error).toContain("not ready yet");
  });

  test("the db file is owner-only", () => {
    expect(statSync(db.path).mode & 0o777).toBe(0o600);
  });

  test("a malformed key answers a fixed line that does not echo it", async () => {
    const r = await call("POST", "/workspaces", { apiKey: "short key" });
    expect(r.status).toBe(400);
    expect(r.json()).toEqual({ error: "That does not look like a Linear API key." });
    expect(r.text).not.toContain("short key");
  });

  test("a rejected key answers the settings page's line and is not stored", async () => {
    const r = await call("POST", "/workspaces", { apiKey: BAD });
    expect(r.status).toBe(400);
    expect(r.json()).toEqual({ error: "Linear rejected that key. Check that it was copied in full." });
    expect((await call("GET", "/settings")).json().workspaces).toEqual([]);
  });

  test("a good key adds the workspace with its name and last 4", async () => {
    const r = await call("POST", "/workspaces", { apiKey: KEY });
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ id: "org-acme", name: "Acme", urlKey: "acme", viewerName: "Alex Doe", keyLast4: KEY.slice(-4), status: "ok" });
    expect(Object.keys(r.json())).not.toContain("apiKey");
  });

  test("after the first poll: lists, count, and a trigger that serves nothing old", async () => {
    await poll();
    const issues = (await call("GET", "/issues")).json();
    expect(issues.ready).toBe(true);
    expect(issues.assigned.map((r: { identifier: string }) => r.identifier)).toEqual(["ENG-412", "ENG-350", "WEB-77"]);
    expect(issues.assigned[0].description).toBeUndefined();
    expect((await call("GET", "/count")).json()).toEqual({ unseen: 3 });
    expect(await events()).toEqual({ events: [] });
  });

  test("an issue new since the first poll is one event", async () => {
    db.run("UPDATE linear_radar_first_seen SET initial = 0, first_seen_at = ? WHERE issue_id = ?", ["2026-11-03T10:00:00.000Z", "iss-c1"]);
    const e = await events("2026-11-03T09:00:00.000Z");
    expect(e.events.map((x: { key: string }) => x.key)).toEqual(["iss-c1"]);
    expect(e.events[0].start.title).toBe("Linear ENG-418: Spike: replace the cron runner with a queue");
  });

  test("an unknown trigger and a bad since are error replies", async () => {
    expect(await answerTriggerRequest(triggerHandlers, { trigger: "nope", since: null })).toEqual({ error: 'no trigger "nope" here' });
    expect(await events("yesterday")).toEqual({ error: "since must be an ISO time" });
  });

  test("settings save the interval", async () => {
    expect((await call("PUT", "/settings", { refreshSec: 900 })).json()).toEqual({ refreshSec: 900 });
    expect((await call("GET", "/settings")).json().refreshSec).toBe(900);
    expect((await call("PUT", "/settings", { refreshSec: 42 })).status).toBe(400);
  });

  test("replace: a key of the same workspace replaces it; a rejected one is refused", async () => {
    const r = await call("PUT", "/workspaces/org-acme/key", { apiKey: KEY2 });
    expect(r.status).toBe(200);
    expect(r.json().keyLast4).toBe(KEY2.slice(-4));
    expect((await call("PUT", "/workspaces/org-acme/key", { apiKey: BAD })).status).toBe(400);
    expect((await call("PUT", "/workspaces/nope/key", { apiKey: KEY2 })).status).toBe(404);
  });

  test("a key Linear starts rejecting: workspace rejected, lists kept, trigger not ready", async () => {
    radarStatus = 401;
    await poll();
    const s = (await call("POST", "/refresh")).json();
    expect(s.workspaces[0].status).toBe("rejected");
    expect(s.assigned.length).toBe(3);
    expect((await events()).error).toContain("not ready yet");
    radarStatus = 200;
  });

  test("delete removes the workspace and its first-seen rows", async () => {
    expect((await call("DELETE", "/workspaces/org-acme")).json()).toEqual({ ok: true });
    expect((await call("GET", "/issues")).json().assigned).toEqual([]);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM linear_radar_first_seen")!.n).toBe(0);
    expect((await call("DELETE", "/workspaces/org-acme")).status).toBe(404);
  });

  test("a poll that outlives its workspace (removed mid-request) records nothing", async () => {
    await call("POST", "/workspaces", { apiKey: KEY });
    const stale = ws.getWorkspace("org-acme")!;
    await call("DELETE", "/workspaces/org-acme");
    const lists = mapRadar(radar.data as never, { id: "org-acme", name: "Acme", urlKey: "acme" });
    expect(ws.recordPoll(stale, lists, new Date().toISOString())).toBe(false);
    expect(seenRows()).toEqual([]);
  });

  test("a workspace's first poll makes every issue initial, even over rows left behind", async () => {
    db.run("INSERT INTO linear_radar_first_seen (issue_id, workspace_id, first_seen_at, initial) VALUES ('iss-a1', 'org-acme', '2026-11-03T10:00:00.000Z', 0)");
    await call("POST", "/workspaces", { apiKey: KEY });
    await poll();
    expect(seenRows().every((r) => r.initial === 1)).toBe(true);
    expect(await events()).toEqual({ events: [] });
  });

  test("another person's key for the workspace starts over: their next poll is a first poll", async () => {
    db.run("UPDATE linear_radar_first_seen SET initial = 0 WHERE issue_id = 'iss-c1'");
    const r = await call("PUT", "/workspaces/org-acme/key", { apiKey: OTHER });
    expect(r.json()).toMatchObject({ viewerName: "Kim Lee" });
    // The PUT started a poll already; it ran as a first poll.
    await poll();
    expect(seenRows().every((x) => x.initial === 1)).toBe(true);
    // The same person's new key keeps the history.
    await call("PUT", "/workspaces/org-acme/key", { apiKey: OTHER });
    expect(db.get<{ p: string | null }>("SELECT polled_at AS p FROM linear_radar_workspaces")!.p).not.toBeNull();
  });

  test("more than 50 issues: an old one past the first page that gets updated never fires; a new one does", async () => {
    await call("DELETE", "/workspaces/org-acme");
    const node = radar.data.assigned.nodes[0];
    const issue = (n: number, createdAt: string) => ({ ...node, id: `big-${n}`, identifier: `ENG-${n}`, title: `Issue ${n}`, createdAt, updatedAt: createdAt });
    const OLD = "2025-01-01T00:00:00.000Z";
    const page = (nodes: unknown[]) => ({
      data: { ...radar.data, assigned: { nodes, pageInfo: { hasNextPage: true } },
        created: { nodes: [], pageInfo: { hasNextPage: false } }, subscribed: { nodes: [], pageInfo: { hasNextPage: false } },
        notifications: { nodes: [] } },
    });
    // 60 assigned issues; Linear sends the newest 50.
    const all = Array.from({ length: 60 }, (_, n) => issue(n, OLD));
    radarBody = page(all.slice(0, 50));
    await call("POST", "/workspaces", { apiKey: KEY });
    await poll();
    const baseline = await events();
    expect(baseline).toEqual({ events: [] });
    // Issue 55 was on page 2 all along. A comment bumps it into the first 50.
    radarBody = page([all[55], ...all.slice(0, 49)]);
    await poll();
    expect(await events()).toEqual({ events: [] });
    // A genuinely new issue does fire.
    radarBody = page([issue(99, new Date(Date.now() + 1000).toISOString()), all[55], ...all.slice(0, 48)]);
    await poll();
    expect((await events()).events.map((e: { key: string }) => e.key)).toEqual(["big-99"]);
    // Linear later sends everything (issues closed): an old one never seen still does not fire.
    radarBody = { data: { ...page([all[57]]).data, assigned: { nodes: [all[57]], pageInfo: { hasNextPage: false } } } };
    await poll();
    expect(await events()).toEqual({ events: [] });
    radarBody = null;
  });

  test("no key appears in any response body or any log line", () => {
    expect(bodies.length).toBeGreaterThan(15);
    expect(logs.length).toBeGreaterThan(0); // the rejected poll warned: the spy is looking
    for (const k of [KEY, KEY2, BAD, OTHER]) {
      for (const b of bodies) expect(b).not.toContain(k);
      expect(JSON.stringify(logs.map((l) => l.map(String)))).not.toContain(k);
    }
  });
});
