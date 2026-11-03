import { unwrap } from "@barista/plugin-sdk/ui/http";
import type { Settings, SettingsReply, Snapshot, WorkspacePublic } from "./types.js";

// Plain fetch with named types: hc<AppType> would drag the server modules (sqlite) into the
// browser typecheck. Every call goes through unwrap(): res.json() does not throw on a 4xx/5xx.
const BASE = "/api/linear-radar";
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getSnapshot = () => unwrap<Snapshot>(fetch(`${BASE}/issues`));
export const refresh = () => unwrap<Snapshot>(fetch(`${BASE}/refresh`, { method: "POST" }));
export const getSettings = () => unwrap<SettingsReply>(fetch(`${BASE}/settings`));
export const saveSettings = (s: Settings) => unwrap<Settings>(fetch(`${BASE}/settings`, json("PUT", s)));
export const addKey = (apiKey: string) => unwrap<WorkspacePublic>(fetch(`${BASE}/workspaces`, json("POST", { apiKey })));
export const replaceKey = (id: string, apiKey: string) =>
  unwrap<WorkspacePublic>(fetch(`${BASE}/workspaces/${encodeURIComponent(id)}/key`, json("PUT", { apiKey })));
export const removeWorkspace = (id: string) =>
  unwrap<{ ok: true }>(fetch(`${BASE}/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }));
