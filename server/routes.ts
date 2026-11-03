import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { automationEvents } from "@barista/plugin-sdk/automations";
import { TRIGGER_ID, triggerEvents } from "./events.js";
import { addKey, removeKey, replaceKey, type NewWorkspace } from "./keys.js";
import { gql, LinearError } from "./linear.js";
import { forget, getSnapshot, poll, pollFresh, schedule } from "./poller.js";
import { VIEWER_QUERY, type Viewer } from "./query.js";
import { getSettings, saveSettings } from "./settings.js";
import { REFRESH_CHOICES, type IssueRow, type SettingsReply, type Snapshot } from "./types.js";
import { toPublic } from "./snapshot.js";
import { firstSeen, getWorkspace, listWorkspaces } from "./workspaces.js";

export const MAX_WORKSPACES = 5;
export const REJECTED = "Linear rejected that key. Check that it was copied in full.";
export const NOT_A_KEY = "That does not look like a Linear API key.";

// A zod error on a key route answers this fixed line: it never echoes the input (the key).
const keyBody = zValidator(
  "json",
  z.object({ apiKey: z.string().trim().min(20).max(200).regex(/^\S+$/) }),
  (r, c) => (r.success ? undefined : c.json({ error: NOT_A_KEY }, 400)),
);
const settingsBody = zValidator(
  "json",
  z.object({ refreshSec: z.union(REFRESH_CHOICES.map((n) => z.literal(n)) as [z.ZodLiteral<60>, z.ZodLiteral<300>, z.ZodLiteral<900>]) }),
);

type Checked = { ok: true; ws: NewWorkspace } | { ok: false; status: 400 | 502; error: string };

/** Ask Linear who the key belongs to. A rejected key answers the settings page's line. */
async function checkKey(key: string): Promise<Checked> {
  try {
    const { data } = await gql<{ viewer: Viewer }>(key, VIEWER_QUERY);
    const o = data.viewer.organization;
    return { ok: true, ws: { id: o.id, name: o.name, urlKey: o.urlKey, viewerId: data.viewer.id, viewerName: data.viewer.name } };
  } catch (e) {
    if (e instanceof LinearError && e.kind === "auth") return { ok: false, status: 400, error: REJECTED };
    return { ok: false, status: 502, error: e instanceof LinearError ? `Linear: ${e.message}` : "Could not check the key with Linear" };
  }
}

/** Descriptions and people names feed only the trigger's start body: the page does not need them. */
const lean = ({ description: _d, assigneeName: _a, creatorName: _c, ...r }: IssueRow): IssueRow => r;
const forPage = (s: Snapshot): Snapshot => ({ ...s, assigned: s.assigned.map(lean), mentions: s.mentions.map(lean), created: s.created.map(lean) });

const settingsReply = (): SettingsReply => ({ ...getSettings(), workspaces: getSnapshot().workspaces });

const app = new Hono()
  .get("/settings", (c) => c.json(settingsReply()))
  .put("/settings", settingsBody, (c) => {
    const saved = saveSettings(c.req.valid("json"));
    void pollFresh().then(() => schedule());
    return c.json(saved);
  })
  .post("/workspaces", keyBody, async (c) => {
    const key = c.req.valid("json").apiKey;
    const checked = await checkKey(key);
    if (!checked.ok) return c.json({ error: checked.error }, checked.status);
    const existing = listWorkspaces();
    if (!existing.some((w) => w.id === checked.ws.id) && existing.length >= MAX_WORKSPACES) {
      return c.json({ error: `At most ${MAX_WORKSPACES} workspaces. Remove one first.` }, 400);
    }
    addKey(checked.ws, key);
    void pollFresh().then(() => schedule());
    return c.json(toPublic(getWorkspace(checked.ws.id)!));
  })
  .put("/workspaces/:id/key", keyBody, async (c) => {
    const id = c.req.param("id");
    if (!getWorkspace(id)) return c.json({ error: "No such workspace" }, 404);
    const key = c.req.valid("json").apiKey;
    const checked = await checkKey(key);
    if (!checked.ok) return c.json({ error: checked.error }, checked.status);
    if (checked.ws.id !== id) return c.json({ error: "That key belongs to another workspace." }, 400);
    replaceKey(checked.ws, key);
    void pollFresh().then(() => schedule());
    return c.json(toPublic(getWorkspace(id)!));
  })
  .delete("/workspaces/:id", (c) => {
    const id = c.req.param("id");
    if (!removeKey(id)) return c.json({ error: "No such workspace" }, 404);
    forget(id);
    return c.json({ ok: true as const });
  })
  .get("/issues", (c) => c.json(forPage(getSnapshot())))
  .post("/refresh", async (c) => c.json(forPage(await poll())))
  .get("/count", (c) => c.json({ unseen: getSnapshot().unseen }))
  // The SDK route: it checks the trigger id and `since`, validates the events, and answers 503 for null.
  .route("/", automationEvents({ [TRIGGER_ID]: ({ since }) => triggerEvents(getSnapshot(), firstSeen(), since) }));

export type AppType = typeof app;
export default app;
