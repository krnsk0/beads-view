# beads-view

A full-screen terminal viewer for the [beads](https://github.com/steveyegge/beads) (`bd`) issue tracker. Two panes (task list + detail), live updates when anything else writes to the beads database, and two actions: Enter copies the selected issue id to the clipboard, and `c` closes the selected issue behind a confirmation modal (the close runs through `bd close`, never direct SQL).

## Architecture

The viewer walks up from the cwd to find `.beads/`, reads `metadata.json` for the dolt mode and database name (a missing file just degrades live updates, it is never fatal), and fetches all data by shelling out to `bd list --all -n 0 --json` with the workspace root as cwd. Both the bare-array and v2 envelope (`{"schema_version":1,"data":[...]}`) output shapes are accepted. All state derivation (bucketing into in_progress/open/blocked/unknown/deferred/closed, sorting, filtering, row/detail formatting) is pure functions in `src/logic.ts`.

Change detection is dual-mode (`src/detector.ts`). In server mode it holds a persistent MySQL connection to the shared dolt sql-server (port from `~/.beads/shared-server/dolt-server.port`, fallback 3308) and polls `SELECT dolt_hashof_db()` every 500ms; a hash change triggers a debounced re-fetch through the bd CLI. If the connection fails it retries with backoff and meanwhile degrades to embedded-style polling. In embedded mode (or when metadata is unreadable) it simply re-runs the bd fetch every 2s; the store (`src/store.ts`) diffs an `id:status:updated_at` snapshot so no-op polls never re-render, drops overlapping loads, and keeps the UI alive through fetch errors. No file watchers anywhere, so bd reads touching dolt files can't self-trigger.

The TUI (`src/tui/App.tsx`) is Ink/React running on Bun. Layout is always stacked — the task list renders above the detail pane at full pane width, favoring the list (~60/40 split); the detail pane already scrolls, so it can afford the smaller share. This stays usable from a ~70-column half-right cmux pane up through a ~110+-column full-right pane, adapting from the measured terminal size on every resize. List rows lead with the issue id rendered dim (models refer to beads by id; Enter copies it), strip any leading `[bracket]`-style title prefix, wrap titles to at most 2 lines, and show priority (plus assignee, when set) as a compact right-aligned `[chip]`; rows that don't fit are summarized with an "N more…" indicator rather than clipped silently. Selection is tracked by issue id so refreshes never steal it, and the detail pane's scroll position survives refreshes of the same issue. The legend bar shows the workspace name, dolt mode, a LOCAL/SYNCED badge (from `sync.remote` in `.beads/config.yaml`), and whether live updates are running over SQL or polling.

The list opens on **Roadmap**, with backlog and closed issues hidden. `b` includes
backlog alongside the roadmap; `a` independently includes closed work. Both toggles
reset on launch and only affect display. Backlog means `deferred` (including no
date) or a nonclosed issue with a future `defer_until`. Unknown statuses remain
visible with `?` and their original status in the detail pane.

Tasks sort by status group (in progress, open, blocked, unknown, backlog, closed),
then priority, newest creation time, and stable input order. The viewer loads the
full task set so hidden dependencies still count as blockers; deferring a parent
does not hide its open children. Selection follows its task while visible and
falls back to the nearest row when hidden.

## Keybindings

| Key | Action |
| --- | --- |
| `q`, `Ctrl-C` | Quit |
| `r` | Manual refresh |
| `b` | Toggle include/hide backlog alongside the roadmap |
| `a` | Toggle show/hide closed issues independently |
| `Tab` | Switch focus between list and detail panes |
| `↑`/`↓`, `j`/`k` | List focused: move selection (detail follows live) |
| `↑`/`↓`, `j`/`k` | Detail focused: scroll by 2 lines |
| `Enter` | Copy selected issue id to clipboard (pbcopy on macOS, OSC 52 elsewhere) |
| `c` | Close the selected issue (works from either pane); a confirmation modal opens — `y` closes via `bd close`, `n`/`Esc`/`q` cancel. Already-closed issues just flash a notice |

Icons: ⚪ open (ready) · ⏳ in progress · ⛔ blocked (explicit status or unresolved deps) · ? unknown status · ❄ backlog · ✅ closed.

## Dev

```bash
bun start            # run from source (inside a beads-enabled project)
bun test             # pure-logic, store, detector, and TUI render tests
bun run build        # bundle + compile self-contained binary to dist/beads-view
bun scripts/live-smoke.ts <workspace-dir> [seconds]   # headless data/live-update harness
```
