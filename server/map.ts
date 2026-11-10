import { NOTIFICATIONS_PAGE, type GqlIssue, type GqlNotification, type RadarData } from "./query.js";
import type { IssueRow, Lists, MentionNote, Priority, Why } from "./types.js";

const MENTION_TYPES: Record<string, Why> = { issueMention: "mention", issueCommentMention: "comment-mention" };
const CLOSED = new Set(["completed", "canceled"]);

export const isOpen = (i: GqlIssue) => !CLOSED.has(i.state?.type ?? "");

/** Unseen first, then the most recently updated. */
export const byUnseenThenUpdated = (a: IssueRow, b: IssueRow) =>
  Number(b.unseen) - Number(a.unseen) || b.updatedAt.localeCompare(a.updatedAt);

const priorityOf = (p: number): Priority => (Number.isInteger(p) && p >= 0 && p <= 4 ? (p as Priority) : 0);

const GITHUB_PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

/** Linked GitHub PRs, only URLs that are exactly a PR (they go into an agent's prompt as links). */
export const prsOf = (i: GqlIssue): string[] => [
  ...new Set((i.attachments?.nodes ?? []).map((a) => a.url?.replace(/[#?].*$/, "").replace(/\/$/, "")).filter((u): u is string => !!u && GITHUB_PR.test(u))),
];

const notificationIssueId = (n: GqlNotification) => n.issueId ?? n.issue?.id ?? null;

/** Every @mention of me in the page, newest first. Closed issues count: a mention on a done issue is still a question for me. */
export function mentionNotes(notes: GqlNotification[], ws: IssueRow["workspace"]): MentionNote[] {
  const out: MentionNote[] = [];
  for (const n of notes) {
    if (!MENTION_TYPES[n.type] || !n.issue) continue;
    const kind = n.type === "issueCommentMention" ? "comment" : "issue";
    const note: MentionNote = { id: n.id, kind, by: n.actor?.name ?? n.comment?.user?.name ?? "", at: n.createdAt, issue: toRow(n.issue, ws, !n.readAt) };
    if (kind === "comment" && n.comment) note.comment = { body: n.comment.body ?? "", url: n.comment.url ?? "" };
    out.push(note);
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

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
    delegate: i.delegate?.name ?? "",
    prs: prsOf(i),
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
    mentionNotes: mentionNotes(notes, ws),
    notificationsCut: notes.length >= NOTIFICATIONS_PAGE,
  };
}
