/**
 * The GraphQL we send Linear: one request per workspace per poll, plus two rare ones. Pure.
 * Validated against Linear's live schema (a query is validated before auth is checked, so an
 * unauthenticated request answering AUTHENTICATION_ERROR means the text is valid).
 */

/** The notifications page size: a full page means older ones may be behind it. */
export const NOTIFICATIONS_PAGE = 100;

export const RADAR_QUERY = `query Radar($assigned: IssueFilter!, $created: IssueFilter!, $subscribed: IssueFilter!) {
  viewer { id name organization { id name urlKey } }
  assigned: issues(first: 50, orderBy: updatedAt, filter: $assigned) { nodes { ...Iss } pageInfo { hasNextPage } }
  created: issues(first: 50, orderBy: updatedAt, filter: $created) { nodes { ...Iss } pageInfo { hasNextPage } }
  subscribed: issues(first: 50, orderBy: updatedAt, filter: $subscribed) { nodes { ...Iss } pageInfo { hasNextPage } }
  notifications(first: ${NOTIFICATIONS_PAGE}, orderBy: updatedAt) {
    nodes { id type readAt snoozedUntilAt createdAt actor { name }
      ... on IssueNotification { issueId issue { ...Iss } comment { id body url user { name } } } }
  }
}
fragment Iss on Issue {
  id identifier title url priority priorityLabel createdAt updatedAt description
  state { name type color }
  team { id key name }
  cycle { number name isActive startsAt endsAt }
  project { id name }
  labels(first: 10) { nodes { name color } }
  assignee { id name isMe }
  creator { id name isMe }
  delegate { id name }
  attachments(first: 10) { nodes { url sourceType } }
}`;

export const VIEWER_QUERY = `query { viewer { id name organization { id name urlKey } } }`;

export const TEAMS_QUERY = `query { teams(first: 100) { nodes { id key name } } }`;

/** Open = not done and not cancelled; every list filter carries it. */
export const OPEN = { state: { type: { nin: ["completed", "canceled"] } } };

export interface RadarVars {
  assigned: Record<string, unknown>;
  created: Record<string, unknown>;
  subscribed: Record<string, unknown>;
}

export function buildVars(): RadarVars {
  return {
    assigned: { and: [{ assignee: { isMe: { eq: true } } }, OPEN] },
    created: { and: [{ creator: { isMe: { eq: true } } }, OPEN] },
    subscribed: { and: [{ subscribers: { some: { isMe: { eq: true } } } }, OPEN] },
  };
}

export interface Viewer {
  id: string;
  name: string;
  organization: { id: string; name: string; urlKey: string };
}

export interface GqlIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel?: string;
  createdAt: string;
  updatedAt: string;
  description?: string | null;
  state: { name: string; type: string; color?: string } | null;
  team: { id: string; key: string; name: string } | null;
  cycle: { number: number; name?: string | null; isActive?: boolean | null } | null;
  project: { id: string; name: string } | null;
  labels: { nodes: { name: string; color?: string }[] } | null;
  assignee: { id: string; name: string; isMe: boolean } | null;
  creator: { id: string; name: string; isMe: boolean } | null;
  /** An agent the issue is delegated to (Linear's agents, e.g. a coding agent). */
  delegate?: { id: string; name: string } | null;
  attachments?: { nodes: { url: string; sourceType?: string | null }[] } | null;
}

export interface GqlConnection {
  nodes: GqlIssue[];
  pageInfo: { hasNextPage: boolean };
}

export interface GqlNotification {
  id: string;
  type: string;
  readAt: string | null;
  snoozedUntilAt: string | null;
  createdAt: string;
  actor?: { name: string } | null;
  issueId?: string | null;
  issue?: GqlIssue | null;
  /** The comment that mentions me, on a comment mention. */
  comment?: { id: string; body: string; url: string; user?: { name: string } | null } | null;
}

export interface RadarData {
  viewer: Viewer;
  assigned: GqlConnection;
  created: GqlConnection;
  subscribed: GqlConnection;
  notifications: { nodes: GqlNotification[] };
}

export interface TeamsData {
  teams: { nodes: { id: string; key: string; name: string }[] };
}
