# barista-linear-radar

A [Barista](https://github.com/LLjo/Barista) plugin that lists the open Linear issues that involve you
(**Assigned**, **Mentions & subscribed**, **Created by me**), unseen first, with priority, state and cycle
badges and links into Linear. It also gives Barista Automations a trigger, **"New Linear issue for me"**.

> Status: design. The plugin is not built yet. See `docs/SPEC.md` and the mockups in `docs/design/`.

## Install

In Barista, open **Plugins → Install from repo** and enter `https://github.com/LLjo/barista-linear-radar`.

## Setup

1. In Linear, open **Settings → Security & access → Personal API keys** and create a key.
   Linear Radar only reads; it never writes to Linear.
2. In Barista, open **Linear Radar → ⚙ Settings**, paste the key and press **Add**. Add one key per
   Linear workspace.

The key stays on the Barista host. It is never shown again, never logged and never sent to the browser.

## License

MIT, see `LICENSE`.
