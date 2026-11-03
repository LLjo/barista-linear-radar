# Barista issue #1431: Linear Radar build

Built on `build/issue-1431`, branched from `design/issue-1430` (b17e7fe). The build target is layout C (inbox tabs).

## What was built
- Server (`server/`): the key store (`keys.ts` is the only module that reads the key), the Linear client
  (20 s timeout, every failure a `LinearError`), the pure query, map and events modules, a poll loop with
  injected dependencies, and routes validated by zod. The trigger is served through the SDK's `automationEvents`.
- One addition to the spec's schema: `linear_radar_workspaces.polled_at`, the time of the workspace's first
  good poll. Issues seen in that poll get `initial = 1` and never fire the trigger.
- The notifications query also reads `actor { name }`, for the Mentions list's `by`.
- UI (`ui/`): mockup C, with tabs, an Unseen group, then team groups, a side panel and the settings page
  (`#settings`). Filters are stored in `localStorage` under `linear-radar:filters`.

## Verified
- `bun test`: every suite passes, using invented fixtures in `server/fixtures/`.
- `tsc -p server/tsconfig.json` is clean, and `cd ui && bun run build` succeeds.
- The radar, viewer and teams queries are valid against Linear's live schema. Sent without a key, Linear
  answers `AUTHENTICATION_ERROR` (the query passed validation), not `GRAPHQL_VALIDATION_FAILED`.
- Install from repo on a Barista dev stack: the plugin comes up healthy and Automations lists the trigger.
  A fake key is rejected with the settings page's line.

## Open
- The query's `X-Complexity` cost is not measured yet: it needs a real key. The plugin logs it on its first poll.
- The `linear://` App link is not tried yet: it needs the Linear desktop app.
- Installing from the GitHub URL clones the default branch, so this branch has to be on `main` first.
