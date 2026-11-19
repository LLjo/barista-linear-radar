# barista-linear-radar

A [Barista](https://github.com/LLjo/Barista) plugin that lists the open Linear issues that involve you
(**Assigned**, **Mentions & subscribed**, **Created by me**), unseen first, with priority, state and cycle
badges and links into Linear. It also puts four events on Barista's plugin event bus for Automations: **"New Linear issue for me"**,
**"PR linked to my Linear issue"**, **"Someone mentioned me on a Linear issue"** and **"The agent on my Linear issue commented"**.

## Install

In Barista, open **Plugins → Install from repo** and enter `https://github.com/LLjo/barista-linear-radar`.

## Setup

1. In Linear, open **Settings → Security & access → Personal API keys** and create a key.
   Linear Radar only reads; it never writes to Linear.
2. In Barista, open **Linear Radar → ⚙ Settings**, paste the key and press **Add**. Add one key per
   Linear workspace.

The key stays on the Barista host. It is never shown again, never logged and never sent to the browser.

## Automations

The plugin declares the event **Linear Radar: New Linear issue for me** (`linear-radar:new-issue-for-me`,
`contributes.events`, keyed by the Linear issue). An open issue that newly shows up in one of your lists is
logged as new; a later change to its title or fields is logged as a revision of the same key. It carries team,
label, priority, assignee, project, workspace and list, so a rule can filter on them. Issues that were already
in your lists when a workspace was added are never logged as new. Every poll syncs the plugin's event log, so
it costs no extra Linear requests.
Needs Barista with the plugin event bus (#1442); Linear Radar 0.1 served the older request/reply trigger.
All four events carry `delegate`: the Linear agent the issue is delegated to ("" when none).

**PR linked to my Linear issue** (`linear-radar:pr-linked-for-me`, keyed by the Linear issue) fires when a GitHub
pull request is first linked to an open issue assigned to you, for example when a coding agent the issue is
delegated to opens one. It carries team, label, priority, project, workspace, delegate, creator and repo
(`owner/name` of each linked PR), and its brief lists the PR links. It links the first PR, so Automations skips
an issue whose PR a Barista item already carries. Issues that already had a PR when the
workspace was first synced never fire; an older issue that gets its first PR later does.

**Someone mentioned me on a Linear issue** (`linear-radar:mentioned-me`, keyed by the Linear notification) fires
when someone @mentions you in an issue's description or in a comment, on any issue, open or closed. Each mention
is its own event, so two comments on one issue fire twice. It carries team, label, priority, assignee, state
(the issue's state type, e.g. `completed`), project, workspace, delegate, kind (`issue` or `comment`) and by (who
wrote it). Its brief quotes the comment as untrusted input, followed by the issue, and links the comment. Mentions
are read from the newest 100 notifications; mentions that were already there when the workspace was first synced
(or when you upgraded to Linear Radar 0.4) never fire.

**The agent on my Linear issue commented** (`linear-radar:delegate-replied`, keyed by the Linear comment) fires when
the agent an open issue assigned to you is delegated to posts a comment on it: a top-level comment or a thread
reply, including its replies in the agent-session thread. It fires for comments by the issue's current delegate
only, not for other people's or other agents' comments, and not on issues assigned to someone else. Each comment is
its own event. It carries team, label, priority, assignee, project, workspace, delegate and author (the agent's
name). Its brief quotes the issue, then the comment it replies to (for a thread reply), then the agent's comment, all
as untrusted input, and links the comment. Comments that were already there when the workspace was first synced (or
when you upgraded to Linear Radar 0.5) never fire. For an issue that shows up in your lists later (newly assigned,
already delegated), only comments since the poll before it showed up fire, not its older thread.
To ignore an agent's periodic status or cost comments, set a skip pattern under **Linear Radar → ⚙ Settings →
Agent comments**: a regular expression, case-insensitive, matched against the comment's text (for example
`^\*\*.*cost report`). Empty skips nothing. Changing the pattern never fires a comment made before the change, so
loosening or clearing it does not replay the comments it skipped. Linear Radar reads the newest 20 agent comments on each of your newest 25
open delegated issues.

One limit: Linear Radar reads the newest 50 issues per list and the newest 100 notifications. Once a
workspace has more than that, it cannot tell an old issue that was always there from one that just
arrived, so an issue created before Linear Radar first synced that workspace never fires, even when it
is reassigned to you or mentions you later. Issues created after the first sync always fire.

## Develop

```bash
bun install && bun test && bunx tsc -p server/tsconfig.json
cd ui && bun install && bun run build
```

Tests mock Linear with the invented fixtures in `server/fixtures/`.

## License

MIT, see `LICENSE`.
