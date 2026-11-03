import { describe, expect, test } from "bun:test";
import { isCut, seenEntries } from "./snapshot.js";
import type { IssueRow, Lists } from "./types.js";

const POLLED = "2026-11-01T00:00:00.000Z";
const row = (id: string, createdAt: string): IssueRow => ({
  id, identifier: id, title: id, url: "", workspace: { id: "w", name: "W", urlKey: "w" }, team: { key: "ENG", name: "" },
  priority: 0, state: { name: "Todo", type: "unstarted" }, cycle: null, project: null, labels: [], assignee: "me",
  createdAt, updatedAt: createdAt, unseen: false,
});
const lists = (more: Partial<Lists["more"]> = {}): Lists => ({
  assigned: [row("old", "2026-10-01T00:00:00.000Z"), row("new", "2026-11-02T00:00:00.000Z")],
  mentions: [],
  created: [],
  more: { assigned: false, mentions: false, created: false, ...more },
});
const initial = (l: Lists, polledAt: string | null, cut = false) => Object.fromEntries(seenEntries(l, polledAt, cut).map((e) => [e.id, e.initial]));

describe("isCut", () => {
  test("a list past 50, or a full page of notifications, is a cut", () => {
    expect(isCut(lists())).toBe(false);
    expect(isCut(lists({ created: true }))).toBe(true);
    expect(isCut({ ...lists(), notificationsCut: true })).toBe(true);
  });
});

describe("seenEntries", () => {
  test("the first poll: everything is initial", () => {
    expect(initial(lists(), null)).toEqual({ old: true, new: true });
  });

  test("later, in a complete list: an issue new to us is an event, however old", () => {
    expect(initial(lists(), POLLED)).toEqual({ old: false, new: false });
  });

  test("once the workspace was ever cut at 50: an issue older than the first poll may have been past the cut, so it stays initial", () => {
    expect(initial(lists(), POLLED, true)).toEqual({ old: true, new: false });
  });
});
