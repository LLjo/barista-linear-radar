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
const dir = mkdtempSync(join(tmpdir(), "linear-radar-test-"));
process.env.PLUGIN_DATA_DIR = dir;

let radarStatus = 200;
const realFetch = globalThis.fetch;
const gqlError = (code: string, message: string) => ({ errors: [{ message, extensions: { code } }] });

/** A fake Linear: picks the answer from the query text and the key. */
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const key = (init.headers as Record<string, string>).Authorization;
  const { query } = JSON.parse(String(init.body)) as { query: string };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (key === BAD) return json(gqlError("AUTHENTICATION_ERROR", "Authentication required, not authenticated"), 401);
  if (query.includes("query Radar")) {
    return radarStatus === 200 ? json(radar) : json(gqlError("AUTHENTICATION_ERROR", "Authentication required, not authenticated"), radarStatus);
  }
  if (query.includes("teams(")) return json(teams);
  return json(viewer);
}) as unknown as typeof fetch;

const { default: app } = await import("./routes.js");
const { poll } = await import("./poller.js");
const { db } = await import("./db.js");

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
const events = (since?: string) => call("GET", `/automations/events?trigger=new-issue-for-me${since ? `&since=${since}` : ""}`);

afterAll(() => {
  for (const s of spies) s.mockRestore();
  globalThis.fetch = realFetch;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("routes", () => {
  beforeAll(async () => {
    expect((await events()).status).toBe(503);
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
    const e = await events();
    expect(e.status).toBe(200);
    expect(e.json()).toEqual({ events: [] });
  });

  test("an issue new since the first poll is one event", async () => {
    db.run("UPDATE linear_radar_first_seen SET initial = 0, first_seen_at = ? WHERE issue_id = ?", ["2026-11-03T10:00:00.000Z", "iss-c1"]);
    const e = (await events("2026-11-03T09:00:00.000Z")).json();
    expect(e.events.map((x: { key: string }) => x.key)).toEqual(["iss-c1"]);
    expect(e.events[0].start.title).toBe("Linear ENG-418: Spike: replace the cron runner with a queue");
  });

  test("an unknown trigger is 404, a bad since 400", async () => {
    expect((await call("GET", "/automations/events?trigger=nope")).status).toBe(404);
    expect((await events("yesterday")).status).toBe(400);
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
    expect((await events()).status).toBe(503);
    radarStatus = 200;
  });

  test("delete removes the workspace and its first-seen rows", async () => {
    expect((await call("DELETE", "/workspaces/org-acme")).json()).toEqual({ ok: true });
    expect((await call("GET", "/issues")).json().assigned).toEqual([]);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM linear_radar_first_seen")!.n).toBe(0);
    expect((await call("DELETE", "/workspaces/org-acme")).status).toBe(404);
  });

  test("no key appears in any response body or any log line", () => {
    expect(bodies.length).toBeGreaterThan(15);
    expect(logs.length).toBeGreaterThan(0); // the rejected poll warned: the spy is looking
    for (const k of [KEY, KEY2, BAD]) {
      for (const b of bodies) expect(b).not.toContain(k);
      expect(JSON.stringify(logs.map((l) => l.map(String)))).not.toContain(k);
    }
  });
});
