# barista-linear-radar

A [Barista](https://github.com/LLjo/Barista) plugin that lists the open Linear issues that involve you
(**Assigned**, **Mentions & subscribed**, **Created by me**), unseen first, with priority, state and cycle
badges and links into Linear. It also gives Barista Automations a trigger, **"New Linear issue for me"**.

## Install

In Barista, open **Plugins → Install from repo** and enter `https://github.com/LLjo/barista-linear-radar`.

## Setup

1. In Linear, open **Settings → Security & access → Personal API keys** and create a key.
   Linear Radar only reads; it never writes to Linear.
2. In Barista, open **Linear Radar → ⚙ Settings**, paste the key and press **Add**. Add one key per
   Linear workspace.

The key stays on the Barista host. It is never shown again, never logged and never sent to the browser.

## Automations

The plugin offers the Automations trigger **Linear Radar: New Linear issue for me**. It fires once per issue,
when an open issue newly shows up in one of your lists, and filters on team, label, priority, assignee,
project, workspace and list. Issues that were already in your lists when a rule (or a workspace) was added
never fire. The trigger reads the plugin's last poll, so it costs no extra Linear requests.

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
