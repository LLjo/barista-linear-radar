import type { IssueRow, ListId, Snapshot, WorkspacePublic } from "./types.js";

export const FILTERS_KEY = "linear-radar:filters";

export const LISTS: { id: ListId; label: string }[] = [
  { id: "assigned", label: "Assigned" },
  { id: "mentions", label: "Mentions & subscribed" },
  { id: "created", label: "Created by me" },
];

/** Client-side filters over the snapshot. Off-lists, so a new workspace or team shows by default.
 *  A team is `<workspace id>:<team key>`: two workspaces can both have an ENG. */
export interface Filters {
  tab: ListId;
  offWorkspaces: string[];
  offTeams: string[];
  cycle: boolean;
  urgent: boolean;
}

export const DEFAULT_FILTERS: Filters = { tab: "assigned", offWorkspaces: [], offTeams: [], cycle: false, urgent: false };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseFilters(raw: string | null): Filters {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    return {
      tab: LISTS.some((l) => l.id === v.tab) ? (v.tab as ListId) : "assigned",
      offWorkspaces: strings(v.offWorkspaces),
      offTeams: strings(v.offTeams),
      cycle: v.cycle === true,
      urgent: v.urgent === true,
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function applyFilters(rows: IssueRow[], f: Filters): IssueRow[] {
  return rows.filter(
    (r) =>
      !f.offWorkspaces.includes(r.workspace.id) &&
      !f.offTeams.includes(teamId(r)) &&
      (!f.cycle || !!r.cycle?.active) &&
      (!f.urgent || r.priority === 1 || r.priority === 2),
  );
}

export const teamId = (r: Pick<IssueRow, "workspace" | "team">) => `${r.workspace.id}:${r.team.key}`;

export const allRows = (s: Snapshot | null): IssueRow[] => (s ? [...s.assigned, ...s.mentions, ...s.created] : []);

/** Inside a tab: "Unseen" first, then one group per team (in first-seen order, rows keep theirs). */
export function groups(rows: IssueRow[]): { unseen: IssueRow[]; teams: { id: string; key: string; rows: IssueRow[] }[] } {
  const unseen = rows.filter((r) => r.unseen);
  const teams: { id: string; key: string; rows: IssueRow[] }[] = [];
  for (const r of rows) {
    if (r.unseen) continue;
    let g = teams.find((t) => t.id === teamId(r));
    if (!g) teams.push((g = { id: teamId(r), key: r.team.key, rows: [] }));
    g.rows.push(r);
  }
  return { unseen, teams };
}

/** The side panel's team list: teams with an issue, plus any switched off (so they can be switched back).
 *  With several workspaces, each label names its workspace too. */
export function teamCounts(s: Snapshot | null, off: string[]): { id: string; label: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of allRows(s)) counts.set(teamId(r), (counts.get(teamId(r)) ?? 0) + 1);
  const many = (s?.workspaces.length ?? 0) > 1;
  const ids = [...new Set([...counts.keys(), ...off])].filter((id) => id.includes(":")).sort();
  return ids.map((id) => {
    const [ws, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    const name = s?.teams.find((t) => t.workspaceId === ws && t.key === key)?.name ?? key;
    const wsName = s?.workspaces.find((w) => w.id === ws)?.name;
    return { id, label: many && wsName ? `${key} · ${wsName}` : key, name, count: counts.get(id) ?? 0 };
  });
}

export function workspaceCounts(s: Snapshot | null): { ws: WorkspacePublic; count: number }[] {
  const rows = allRows(s);
  return (s?.workspaces ?? []).map((ws) => ({ ws, count: rows.filter((r) => r.workspace.id === ws.id).length }));
}

/** Compact age: "now", "5m", "2h", "3d", "1w". */
export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (7 * 86400))}w`;
}

function ago(iso: string, now: number): string {
  const m = Math.floor(Math.max(0, now - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** The bar's sync line. A rate limit or a failed poll never reads as fresh. */
export function syncLine(s: Snapshot | null, now = Date.now()): string {
  if (!s) return "syncing…";
  if (!s.workspaces.length) return "";
  const failed = (w: WorkspacePublic) => !!w.lastError || w.status === "rejected";
  const last = s.fetchedAt ? `last sync ${ago(s.fetchedAt, now)}` : "not synced yet";
  if (s.workspaces.some((w) => w.pausedUntil && Date.parse(w.pausedUntil) > now)) return `rate limited · ${last}`;
  if (s.workspaces.every(failed)) return `sync failed · ${last}`;
  return s.fetchedAt ? `synced ${ago(s.fetchedAt, now)}` : "syncing…";
}

/** A tab's total: "50+" when Linear had more than it sent. */
export const total = (n: number, more: boolean) => (more ? `${n}+` : String(n));

export const PRIORITY = ["No priority", "Urgent", "High", "Medium", "Low"] as const;

/** Linear's In Review is a `started` state: it gets the review chip, as in the mockups. */
export function stateKind(st: IssueRow["state"]): string {
  if (st.type === "started" && /review/i.test(st.name)) return "review";
  return ["triage", "backlog", "unstarted", "started"].includes(st.type) ? st.type : "backlog";
}

export function stateGlyph(kind: string): string {
  return kind === "started" ? "◐" : kind === "review" ? "◑" : kind === "triage" ? "◇" : "○";
}

/** The desktop app's deep link: Linear's web URL on the `linear://` scheme. */
export const appLink = (url: string) => url.replace(/^https:\/\/linear\.app\//, "linear://");

const WHY = { mention: "mentioned you", "comment-mention": "mentioned you in a comment", subscribed: "subscribed" } as const;

export function whyText(r: IssueRow): string {
  if (!r.why) return "";
  return `${r.by ? `${r.by} ` : ""}${WHY[r.why]}`;
}

/** The page-wide lines: a rejected key or a failing workspace, by name. */
export function problems(s: Snapshot | null, now = Date.now()): string[] {
  const out: string[] = [];
  for (const w of s?.workspaces ?? []) {
    if (w.status === "rejected") out.push(`Linear rejected the key for ${w.name}. Replace it in settings.`);
    else if (w.pausedUntil && Date.parse(w.pausedUntil) > now) continue; // the sync line says it
    else if (w.lastError) out.push(`${w.name}: ${w.lastError}`);
  }
  return out;
}
