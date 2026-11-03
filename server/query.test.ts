import { describe, expect, test } from "bun:test";
import { buildVars, OPEN, RADAR_QUERY } from "./query.js";

describe("buildVars", () => {
  test("every list filter is the viewer's own clause AND the open-state clause", () => {
    const v = buildVars();
    expect(v.assigned).toEqual({ and: [{ assignee: { isMe: { eq: true } } }, OPEN] });
    expect(v.created).toEqual({ and: [{ creator: { isMe: { eq: true } } }, OPEN] });
    expect(v.subscribed).toEqual({ and: [{ subscribers: { some: { isMe: { eq: true } } } }, OPEN] });
  });

  test("open means not completed and not canceled", () => {
    expect(OPEN).toEqual({ state: { type: { nin: ["completed", "canceled"] } } });
  });
});

describe("RADAR_QUERY", () => {
  test("declares the three filter variables it is sent", () => {
    for (const name of Object.keys(buildVars())) expect(RADAR_QUERY).toContain(`$${name}: IssueFilter!`);
  });

  test("reads 50 per list and the newest 100 notifications, with the actor for `by`", () => {
    expect(RADAR_QUERY.match(/issues\(first: 50, orderBy: updatedAt/g)?.length).toBe(3);
    expect(RADAR_QUERY).toContain("notifications(first: 100, orderBy: updatedAt)");
    expect(RADAR_QUERY).toContain("actor { name }");
    expect(RADAR_QUERY).toContain("pageInfo { hasNextPage }");
  });
});
