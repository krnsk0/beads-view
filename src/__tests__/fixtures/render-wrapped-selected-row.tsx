// Standalone render used by row-styling.ansi.test.ts, run as a fresh `bun`
// subprocess with FORCE_COLOR set in its env. Chalk's color-support level is
// detected once at import time and cached for the process, so forcing color
// from inside a shared `bun test` run (after ink/chalk are already loaded by
// another test file) doesn't reliably take effect — a fresh process does.
import { render } from 'ink-testing-library';

import { createIssueStore } from '../../store';
import { App } from '../../tui/App';
import type { Issue } from '../../types';
import type { Workspace } from '../../workspace';

const workspace: Workspace = {
  root: '/tmp/fake',
  beadsDir: '/tmp/fake/.beads',
  name: 'fake',
  doltMode: 'server',
  doltDatabase: 'fake',
  synced: false,
};

// A single issue is selected by default (index 0). Its title is long enough
// to wrap to a second row line at this width.
const issues: Issue[] = [
  {
    id: 'a',
    title: 'A rather long title that should need to wrap onto a second line',
    status: 'open',
    priority: 1,
    created_at: '2026-07-03T00:00:00Z',
    updated_at: '3',
  },
];

const noopDetector = () => ({ stop() {} });
const settle = () => new Promise((r) => setTimeout(r, 20));

const store = createIssueStore(async () => issues);
await store.refresh();
const { lastFrame, unmount } = render(
  <App
    workspace={workspace}
    store={store}
    createDetector={noopDetector}
    initialDims={{ columns: 40, rows: 25 }}
  />,
);
await settle();
process.stdout.write(JSON.stringify(lastFrame() ?? ''));
unmount();
process.exit(0);
