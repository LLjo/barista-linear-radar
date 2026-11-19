import type { BusHandle } from "@barista/plugin-sdk";
import { allPolledOk, DELEGATE_EVENT_ID, delegateEvents, EVENT_ID, issueIds, MENTION_EVENT_ID, mentionEvents, PR_EVENT_ID, prEvents, skipRegex, workspaceEvents } from "./events.js";
import type { DelegateSkip, Lists, Snapshot, WorkspaceRecord } from "./types.js";
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

/** The SDK handle as the radar uses it. */
export type RadarBusHandle = Pick<BusHandle, "sync" | "readToken" | "markReady">;

/**
 * The bridge from the poller to `barista.events.serve`. The scope is the workspace id (stable across a renamed
 * URL key; one issue lives in one workspace, so a key never moves between scopes). Issues are read from
 * `firstSeen` at sync time, so a workspace removed mid-poll (its rows deleted) syncs nothing back.
 */
/** `good[].w` is the workspace as it was BEFORE this poll: its `checkedAt` is the previous good poll (delegate cutoff). */
export function radarBus(
  bus: RadarBusHandle,
  firstSeen: (ids: string[]) => Map<string, FirstSeen>,
  /** The delegate-replied skip setting and when it last changed, read at each poll. */
  skipSetting: () => DelegateSkip = () => ({ pattern: "", since: null }),
): PollBus {
  return {
    readToken: () => bus.readToken(),
    polled(good, s, token) {
      const setting = skipSetting();
      const skip = skipRegex(setting.pattern);
      for (const { w, lists } of good) {
        const seen = firstSeen(issueIds(lists));
        bus.sync(EVENT_ID, w.id, workspaceEvents(lists, seen));
        bus.sync(PR_EVENT_ID, w.id, prEvents(lists, s.fetchedAt ?? new Date().toISOString()));
        bus.sync(MENTION_EVENT_ID, w.id, mentionEvents(lists));
        bus.sync(DELEGATE_EVENT_ID, w.id, delegateEvents(lists, seen, { skip, skipSince: setting.since, prevPoll: w.checkedAt }));
      }
      if (allPolledOk(s)) bus.markReady(token);
    },
    forget(workspaceId) {
      bus.sync(EVENT_ID, workspaceId, []);
      bus.sync(PR_EVENT_ID, workspaceId, []);
      bus.sync(MENTION_EVENT_ID, workspaceId, []);
      bus.sync(DELEGATE_EVENT_ID, workspaceId, []);
    },
  };
}

/**
 * A listener's watch set changed. The radar reads the viewer's own lists whatever is watched (no `watch` field), so
 * the log already holds what a new watch would read: ready again now, without a Linear request — when the last poll
 * left the log trustworthy; otherwise the next all-ok poll does it.
 */
export function onWatchesChanged(bus: RadarBusHandle, s: Snapshot): void {
  if (allPolledOk(s)) bus.markReady(bus.readToken());
}
