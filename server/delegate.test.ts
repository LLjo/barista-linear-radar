import { afterAll, describe, expect, test } from "bun:test";
import type { BusEvent } from "@barista/types/plugin-events";
import { serveBus } from "@barista/plugin-sdk/bus";
import { openStorage } from "@barista/plugin-sdk/sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import manifest from "../manifest.json";
import radar from "./fixtures/radar.json";
import { radarBus } from "./bus.js";
import { DELEGATE_EVENT_ID } from "./events.js";
import { mapRadar } from "./map.js";
import type { GqlComment, RadarData } from "./query.js";
import { buildSnapshot } from "./snapshot.js";
import type { WorkspaceRecord } from "./types.js";
import type { FirstSeen } from "./workspaces.js";

/**
 * delegate-replied through the SDK's real event log: what a listener would see as news (rev 1, not `initial`),
 * poll after poll.
 */
const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const FIRST_POLL = "2026-11-01T00:00:00.000Z";
const WS: WorkspaceRecord = {
  id: "org-acme", name: "Acme", urlKey: "acme", viewerId: "user-me", viewerName: "Alex Doe", keyLast4: "abcd",
  status: "ok", addedAt: FIRST_POLL, checkedAt: null, polledAt: FIRST_POLL,
};
const AGENT = { id: "agent-1", name: "Codey" };
const base = radar.data as unknown as RadarData;

const dir = mkdtempSync(join(tmpdir(), "linear-radar-delegate-"));
const storage = await openStorage({ dir, name: "bus" });
afterAll(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const published: BusEvent[] = [];
const handle = serveBus(
  { storage, name: "linear-radar", contributes: manifest.contributes },
  { publish: (_s, e) => void published.push(e), serve: () => ({ stop() {} }) },
);
let skip = "";
// Every issue stood at the workspace's first poll.
const seen = (ids: string[]) => new Map<string, FirstSeen>(ids.map((id) => [id, { workspaceId: WS.id, at: FIRST_POLL, initial: true }]));
const bus = radarBus(handle, seen, () => skip);

/** The fixture with extra comments on WEB-77 (iss-a2, delegated to the agent). */
function withComments(extra: GqlComment[]): RadarData {
  const nodes = base.delegated!.nodes.map((d) => (d.id === "iss-a2" ? { ...d, comments: { nodes: [...extra, ...d.comments!.nodes] } } : d));
  return { ...base, delegated: { nodes } };
}
const comment = (id: string, body: string, at: string, user = AGENT): GqlComment =>
  ({ id, body, url: `https://linear.app/acme/issue/web-77/x#comment-${id}`, createdAt: at, user, parent: null });

/** One good poll; answers the keys a listener takes as news. */
function poll(data: RadarData): string[] {
  const lists = mapRadar(data, { id: WS.id, name: WS.name, urlKey: WS.urlKey }, NOW);
  const s = buildSnapshot([WS], new Map([[WS.id, { good: true, lists }]]), { fetchedAt: new Date(NOW).toISOString(), booted: true, now: NOW });
  const from = published.length;
  bus.polled([{ w: WS, lists }], s, handle.readToken());
  return published.slice(from).filter((e) => e.event === DELEGATE_EVENT_ID && !e.initial && !e.gone && e.rev === 1).map((e) => e.key);
}

describe("delegate-replied through the real event log", () => {
  test("first run is a baseline: the comments already there never fire", () => {
    expect(poll(base)).toEqual([]);
    expect(published.filter((e) => e.event === DELEGATE_EVENT_ID).map((e) => [e.key, e.initial])).toEqual([
      ["cd-cost", true], ["cd-reply", true], ["cd-top", true],
    ]);
  });

  test("a new comment by the delegate on my issue fires once; a repeat poll does not fire it again", () => {
    const data = withComments([comment("cd-new", "Done. Can you check the preview?", "2026-11-03T11:50:00.000Z")]);
    expect(poll(data)).toEqual(["cd-new"]);
    expect(poll(data)).toEqual([]);
  });

  test("a comment by someone else, or by the delegate on another person's issue, never fires", () => {
    const data = withComments([comment("cd-human", "Looks good to me.", "2026-11-03T11:55:00.000Z", { id: "user-sam", name: "Sam Rivera" })]);
    const theirs = { ...data, delegated: { nodes: data.delegated!.nodes.map((d) => (d.id === "iss-c2" ? { ...d, comments: { nodes: [comment("cd-theirs-2", "Fixed.", "2026-11-03T11:56:00.000Z")] } } : d)) } };
    expect(poll(theirs)).toEqual([]);
  });

  test("a comment the skip regex matches never fires", () => {
    skip = "^\\*\\*.*cost report";
    expect(poll(withComments([comment("cd-cost-2", "**Codey Cost Report**\nTokens: 3k", "2026-11-03T11:58:00.000Z")]))).toEqual([]);
    skip = "";
  });
});
