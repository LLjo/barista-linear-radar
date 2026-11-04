import type { BusHandle } from "@barista/plugin-sdk";
import { allPolledOk, EVENT_ID, workspaceEvents } from "./events.js";
import type { Lists, Snapshot, WorkspaceRecord } from "./types.js";
import type { FirstSeen } from "./workspaces.js";

/** What the poll loop tells the event bus. */
export interface PollBus {
  /** Taken BEFORE a poll reads anything (the SDK's readiness token). */
  readToken(): number;
  /** After a poll: sync every workspace that polled good, then mark ready if every workspace did. */
  polled(good: { w: WorkspaceRecord; lists: Lists }[], s: Snapshot, token: number): void;
  /** A removed workspace, or another person's key: nothing of it stands for "me" any more. */
  forget(workspaceId: string): void;
}

/**
 * The bridge from the poller to `barista.events.serve`. The scope is the workspace id (stable across a renamed
 * URL key; one issue lives in one workspace, so a key never moves between scopes). Issues are read from
 * `firstSeen` at sync time, so a workspace removed mid-poll (its rows deleted) syncs nothing back.
 */
export function radarBus(bus: Pick<BusHandle, "sync" | "readToken" | "markReady">, firstSeen: (ids: string[]) => Map<string, FirstSeen>): PollBus {
  const ids = (l: Lists) => [...l.assigned, ...l.mentions, ...l.created].map((r) => r.id);
  return {
    readToken: () => bus.readToken(),
    polled(good, s, token) {
      for (const { w, lists } of good) bus.sync(EVENT_ID, w.id, workspaceEvents(lists, firstSeen(ids(lists))));
      if (allPolledOk(s)) bus.markReady(token);
    },
    forget(workspaceId) {
      bus.sync(EVENT_ID, workspaceId, []);
    },
  };
}
