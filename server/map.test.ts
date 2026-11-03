import { describe, expect, test } from "bun:test";
import radar from "./fixtures/radar.json";
import { mapRadar, unseenIds } from "./map.js";
import type { GqlNotification, RadarData } from "./query.js";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const WS = { id: "org-acme", name: "Acme", urlKey: "acme" };
const data = radar.data as unknown as RadarData;
const lists = mapRadar(data, WS, NOW);
const ids = (rows: { identifier: string }[]) => rows.map((r) => r.identifier);

describe("list precedence", () => {
  test("Assigned holds the assigned issues, unseen first then newest", () => {
    expect(ids(lists.assigned)).toEqual(["ENG-412", "ENG-350", "WEB-77"]);
  });

  test("Created by me drops what is already Assigned", () => {
    expect(ids(lists.created)).toEqual(["ENG-418", "WEB-71"]);
  });

  test("Mentions & subscribed is the rest: subscribed plus open mention issues", () => {
    expect(ids(lists.mentions)).toEqual(["ENG-405", "DES-31", "WEB-80"]);
  });

  test("no issue shows twice, and a closed issue never shows", () => {
    const all = [...lists.assigned, ...lists.created, ...lists.mentions].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("iss-x1");
  });

  test("a full page of 100 notifications marks them cut; 99 does not", () => {
    const page = (n: number) => {
      const d = structuredClone(data);
      d.notifications.nodes = Array.from({ length: n }, (_, i) => ({ ...data.notifications.nodes[7], id: `n-${i}` }));
      return mapRadar(d, WS, NOW).notificationsCut;
    };
    expect(page(99)).toBe(false);
    expect(page(100)).toBe(true);
  });

  test("hasNextPage sets the list's more flag", () => {
    expect(lists.more).toEqual({ assigned: false, created: true, mentions: false });
  });
});

describe("unseen", () => {
  const unseen = (ident: string) => [...lists.assigned, ...lists.created, ...lists.mentions].find((r) => r.identifier === ident)!.unseen;

  test("an unread notification makes its issue unseen", () => {
    expect(unseen("ENG-412")).toBe(true);
    expect(unseen("ENG-405")).toBe(true);
  });

  test("snoozed into the future is seen; a snooze that is over is unseen again", () => {
    expect(unseen("WEB-77")).toBe(false);
    expect(unseen("ENG-350")).toBe(true);
  });

  test("read notifications and no notification are seen", () => {
    expect(unseen("DES-31")).toBe(false);
    expect(unseen("WEB-80")).toBe(false);
  });

  test("notifications without an issue are ignored", () => {
    const n: GqlNotification = { id: "n", type: "projectUpdateCreated", readAt: null, snoozedUntilAt: null, createdAt: "2026-11-03T00:00:00.000Z" };
    expect(unseenIds([n], NOW).size).toBe(0);
  });
});

describe("why and by", () => {
  const m = (ident: string) => lists.mentions.find((r) => r.identifier === ident)!;

  test("the newest mention notification decides why and by", () => {
    expect(m("ENG-405")).toMatchObject({ why: "comment-mention", by: "Kim Lee" });
  });

  test("a mention with no actor has no by", () => {
    expect(m("DES-31").why).toBe("comment-mention");
    expect(m("DES-31").by).toBeUndefined();
  });

  test("a subscribed issue with no mention is subscribed", () => {
    expect(m("WEB-80")).toMatchObject({ why: "subscribed" });
    expect(m("WEB-80").by).toBeUndefined();
  });

  test("Assigned and Created rows carry no why", () => {
    for (const r of [...lists.assigned, ...lists.created]) expect(r.why).toBeUndefined();
  });
});

describe("row fields", () => {
  const a1 = lists.assigned[0];

  test("maps Linear's issue onto the row", () => {
    expect(a1).toMatchObject({
      id: "iss-a1", identifier: "ENG-412", url: "https://linear.app/acme/issue/eng-412/x",
      workspace: WS, team: { key: "ENG", name: "ENG" }, priority: 1,
      state: { name: "In Progress", type: "started" }, cycle: { number: 42, active: true },
      project: "Payments v2", labels: ["bug"], assignee: "me",
    });
  });

  test("assignee is me, someone else or unassigned", () => {
    expect(lists.created.find((r) => r.identifier === "ENG-418")!.assignee).toBe("unassigned");
    expect(lists.created.find((r) => r.identifier === "WEB-71")!.assignee).toBe("someone else");
  });

  test("no cycle, no project and no labels are null, null and []", () => {
    const a3 = lists.assigned.find((r) => r.identifier === "ENG-350")!;
    expect(a3.cycle).toBeNull();
    expect(a3.project).toBeNull();
    expect(a3.labels).toEqual([]);
  });

  test("a Linear priority out of range is no priority", () => {
    const odd = structuredClone(data);
    odd.assigned.nodes[0].priority = 9;
    expect(mapRadar(odd, WS, NOW).assigned.find((r) => r.id === "iss-a1")!.priority).toBe(0);
  });
});
