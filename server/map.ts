import { NOTIFICATIONS_PAGE, type GqlIssue, type GqlNotification, type RadarData } from "./query.js";
import type { IssueRow, Lists, Priority, Why } from "./types.js";

const MENTION_TYPES: Record<string, Why> = { issueMention: "mention", issueCommentMention: "comment-mention" };
const CLOSED = new Set(["completed", "canceled"]);

export const isOpen = (i: GqlIssue) => !CLOSED.has(i.state?.type ?? "");

/** Unseen first, then the most recently updated. */
export const byUnseenThenUpdated = (a: IssueRow, b: IssueRow) =>
  Number(b.unseen) - Number(a.unseen) || b.updatedAt.localeCompare(a.updatedAt);

const priorityOf = (p: number): Priority => (Number.isInteger(p) && p >= 0 && p <= 4 ? (p as Priority) : 0);

const notificationIssueId = (n: GqlNotification) => n.issueId ?? n.issue?.id ?? null;

/** An issue is unseen while one of its notifications is unread and not snoozed into the future. */
export function unseenIds(notifications: GqlNotification[], now: number): Set<string> {
  const out = new Set<string>();
  for (const n of notifications) {
    const id = notificationIssueId(n);
    if (!id || n.readAt) continue;
    if (n.snoozedUntilAt && Date.parse(n.snoozedUntilAt) > now) continue;
    out.add(id);
  }
  return out;
}

export function toRow(i: GqlIssue, ws: IssueRow["workspace"], unseen: boolean): IssueRow {
  const row: IssueRow = {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    url: i.url,
    workspace: ws,
    team: { key: i.team?.key ?? "", name: i.team?.name ?? "" },
    priority: priorityOf(i.priority),
    state: { name: i.state?.name ?? "", type: i.state?.type ?? "" },
    cycle: i.cycle ? { number: i.cycle.number, active: !!i.cycle.isActive } : null,
    project: i.project?.name ?? null,
    labels: (i.labels?.nodes ?? []).map((l) => l.name),
    assignee: !i.assignee ? "unassigned" : i.assignee.isMe ? "me" : "someone else",
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    unseen,
  };
  if (i.description) row.description = i.description;
  if (i.assignee) row.assigneeName = i.assignee.name;
  if (i.creator) row.creatorName = i.creator.name;
  return row;
}

/**
 * The three lists for one workspace. Every issue lands in exactly one, by precedence:
 * Assigned, then Created by me, then Mentions & subscribed (subscribed issues plus open issues
 * of mention notifications) — Linear subscribes creators and assignees automatically.
 */
export function mapRadar(data: RadarData, ws: IssueRow["workspace"], now = Date.now()): Lists {
  const notes = data.notifications?.nodes ?? [];
  const unseen = unseenIds(notes, now);
  const taken = new Set<string>();
  const rows = (issues: GqlIssue[]) => {
    const out: IssueRow[] = [];
    for (const i of issues) {
      if (taken.has(i.id) || !isOpen(i)) continue;
      taken.add(i.id);
      out.push(toRow(i, ws, unseen.has(i.id)));
    }
    return out;
  };
  const assigned = rows(data.assigned.nodes);
  const created = rows(data.created.nodes);

  // The newest mention per issue says why it is here and who put it there.
  const mention = new Map<string, GqlNotification>();
  for (const n of notes) {
    const id = notificationIssueId(n);
    if (!id || !MENTION_TYPES[n.type]) continue;
    const prev = mention.get(id);
    if (!prev || n.createdAt > prev.createdAt) mention.set(id, n);
  }
  const mentionIssues = [...mention.values()].map((n) => n.issue).filter((i): i is GqlIssue => !!i);
  const mentions = rows([...data.subscribed.nodes, ...mentionIssues]).map((r) => {
    const n = mention.get(r.id);
    if (!n) return { ...r, why: "subscribed" as const };
    return n.actor?.name ? { ...r, why: MENTION_TYPES[n.type], by: n.actor.name } : { ...r, why: MENTION_TYPES[n.type] };
  });

  return {
    assigned: assigned.sort(byUnseenThenUpdated),
    created: created.sort(byUnseenThenUpdated),
    mentions: mentions.sort(byUnseenThenUpdated),
    more: {
      assigned: !!data.assigned.pageInfo?.hasNextPage,
      created: !!data.created.pageInfo?.hasNextPage,
      mentions: !!data.subscribed.pageInfo?.hasNextPage,
    },
    notificationsCut: notes.length >= NOTIFICATIONS_PAGE,
  };
}
