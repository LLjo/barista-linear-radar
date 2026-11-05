# barista-linear-radar

A [Barista](https://github.com/LLjo/Barista) plugin that lists the open Linear issues that involve you
(**Assigned**, **Mentions & subscribed**, **Created by me**), unseen first, with priority, state and cycle
badges and links into Linear. It also puts two events on Barista's plugin event bus for Automations: **"New Linear issue for me"**
and **"PR linked to my Linear issue"**.

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
Both events also carry `delegate`: the Linear agent the issue is delegated to ("" when none).

**PR linked to my Linear issue** (`linear-radar:pr-linked-for-me`, keyed by the Linear issue) fires when a GitHub
pull request is first linked to an open issue assigned to you, for example when a coding agent the issue is
delegated to opens one. It carries team, label, priority, project, workspace, delegate, creator and repo
(`owner/name` of each linked PR), and its brief lists the PR links. It links the first PR, so Automations skips
an issue whose PR a Barista item already carries. Issues that already had a PR when the
workspace was first synced never fire; an older issue that gets its first PR later does.

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
