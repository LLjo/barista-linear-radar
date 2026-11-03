import { describe, expect, test } from "bun:test";
import { appLink, applyFilters, DEFAULT_FILTERS, groups, parseFilters, problems, stateKind, syncLine, teamCounts, total, whyText } from "./format.js";
import type { IssueRow, Snapshot, WorkspacePublic } from "./types.js";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const row = (o: Partial<IssueRow> & { id: string }): IssueRow => ({
  identifier: o.id, title: "t", url: `https://linear.app/acme/issue/${o.id}/t`,
  workspace: { id: "org-acme", name: "Acme", urlKey: "acme" }, team: { key: "ENG", name: "Engineering" },
  priority: 3, state: { name: "Todo", type: "unstarted" }, cycle: null, project: null, labels: [],
  assignee: "me", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", unseen: false, ...o,
});
const ws = (o: Partial<WorkspacePublic> = {}): WorkspacePublic => ({
  id: "org-acme", name: "Acme", urlKey: "acme", viewerName: "Alex Doe", keyLast4: "abcd", status: "ok",
  addedAt: "2026-11-01T00:00:00.000Z", checkedAt: null, ...o,
});
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  fetchedAt: "2026-11-03T11:55:00.000Z", ready: true, workspaces: [ws()], teams: [],
  assigned: [], mentions: [], created: [], more: { assigned: false, mentions: false, created: false }, unseen: 0, ...o,
});

describe("filters", () => {
  test("parse tolerates junk and keeps what is valid", () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("{nope")).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(JSON.stringify({ tab: "created", offTeams: ["DES", 3], cycle: true, urgent: "yes" })))
      .toEqual({ ...DEFAULT_FILTERS, tab: "created", offTeams: ["DES"], cycle: true });
    expect(parseFilters(JSON.stringify({ tab: "nope" })).tab).toBe("assigned");
  });

  test("workspace, team, current cycle and urgent + high", () => {
    const rows = [
      row({ id: "a", priority: 1, cycle: { number: 4, active: true } }),
      row({ id: "b", priority: 3, team: { key: "DES", name: "Design" } }),
      row({ id: "c", priority: 2, workspace: { id: "org-nw", name: "Northwind", urlKey: "nw" }, cycle: { number: 5, active: false } }),
    ];
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => applyFilters(rows, { ...DEFAULT_FILTERS, ...f }).map((r) => r.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ offWorkspaces: ["org-nw"] })).toEqual(["a", "b"]);
    expect(ids({ offTeams: ["org-acme:DES"] })).toEqual(["a", "c"]);
    expect(ids({ offTeams: ["org-nw:ENG"] })).toEqual(["a", "b"]);
    expect(ids({ cycle: true })).toEqual(["a"]);
    expect(ids({ urgent: true })).toEqual(["a", "c"]);
  });
});

describe("groups", () => {
  test("unseen first, then one group per team in order", () => {
    const g = groups([row({ id: "1", unseen: true }), row({ id: "2", team: { key: "WEB", name: "" } }), row({ id: "3" }), row({ id: "4", team: { key: "WEB", name: "" }, unseen: true })]);
    expect(g.unseen.map((r) => r.id)).toEqual(["1", "4"]);
    expect(g.teams.map((t) => [t.key, t.rows.map((r) => r.id)])).toEqual([["WEB", ["2"]], ["ENG", ["3"]]]);
  });

  test("team counts cover every list and keep a switched-off team listed", () => {
    const s = snap({ assigned: [row({ id: "1" })], created: [row({ id: "2" })], teams: [{ workspaceId: "org-acme", key: "ENG", name: "Engineering" }] });
    expect(teamCounts(s, ["org-acme:OPS"])).toEqual([
      { id: "org-acme:ENG", label: "ENG", name: "Engineering", count: 2 },
      { id: "org-acme:OPS", label: "OPS", name: "OPS", count: 0 },
    ]);
  });

  test("the same team key in two workspaces is two teams, each named by workspace", () => {
    const nw = { id: "org-nw", name: "Northwind", urlKey: "nw" };
    const s = snap({ workspaces: [ws(), ws({ id: "org-nw", name: "Northwind" })], assigned: [row({ id: "1" }), row({ id: "2", workspace: nw })] });
    expect(teamCounts(s, []).map((t) => t.label)).toEqual(["ENG · Acme", "ENG · Northwind"]);
  });
});

describe("row text", () => {
  test("In Review (a started state) gets the review chip; unknown types read as backlog", () => {
    expect(stateKind({ name: "In Review", type: "started" })).toBe("review");
    expect(stateKind({ name: "In Progress", type: "started" })).toBe("started");
    expect(stateKind({ name: "Triage", type: "triage" })).toBe("triage");
    expect(stateKind({ name: "Odd", type: "custom" })).toBe("backlog");
  });

  test("the App link is the web URL on linear://", () => {
    expect(appLink("https://linear.app/acme/issue/ENG-412/checkout")).toBe("linear://acme/issue/ENG-412/checkout");
  });

  test("why reads with the actor when there is one", () => {
    expect(whyText(row({ id: "1", why: "comment-mention", by: "Kim Lee" }))).toBe("Kim Lee mentioned you in a comment");
    expect(whyText(row({ id: "1", why: "subscribed" }))).toBe("subscribed");
    expect(whyText(row({ id: "1" }))).toBe("");
  });

  test("a list Linear had more of reads 50+", () => {
    expect(total(50, true)).toBe("50+");
    expect(total(3, false)).toBe("3");
  });
});

describe("sync line and problems", () => {
  test("fresh, rate limited, failed, and nothing configured", () => {
    expect(syncLine(snap(), NOW)).toBe("synced 5 min ago");
    expect(syncLine(snap({ workspaces: [ws({ pausedUntil: "2026-11-03T12:05:00.000Z", lastError: "Rate limited by Linear" })] }), NOW)).toBe("rate limited · last sync 5 min ago");
    expect(syncLine(snap({ workspaces: [ws({ status: "rejected" })] }), NOW)).toBe("sync failed · last sync 5 min ago");
    expect(syncLine(snap({ workspaces: [] }), NOW)).toBe("");
    expect(syncLine(snap({ fetchedAt: null, ready: false }), NOW)).toBe("syncing…");
  });

  test("a rejected key and a failing workspace each get a line; a rate limit does not", () => {
    const s = snap({ workspaces: [ws({ status: "rejected" }), ws({ id: "b", name: "Northwind", lastError: "Could not reach Linear" }), ws({ id: "c", name: "C", lastError: "Rate limited by Linear", pausedUntil: "2026-11-03T13:00:00.000Z" })] });
    expect(problems(s, NOW)).toEqual(["Linear rejected the key for Acme. Replace it in settings.", "Northwind: Could not reach Linear"]);
  });
});
