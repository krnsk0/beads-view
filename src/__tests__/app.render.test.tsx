import { render } from 'ink-testing-library';

import { createIssueStore } from '../store';
import { App } from '../tui/App';
import type { Issue } from '../types';
import type { Workspace } from '../workspace';
import { describe, expect, it } from 'bun:test';

const workspace: Workspace = {
  root: '/tmp/fake',
  beadsDir: '/tmp/fake/.beads',
  name: 'fake',
  doltMode: 'server',
  doltDatabase: 'fake',
  synced: false,
};

const issues: Issue[] = [
  {
    id: 'fake-wip',
    title: 'Working on it',
    status: 'in_progress',
    priority: 1,
    assignee: 'jon',
    description: 'Detail body here',
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2',
  },
  {
    id: 'fake-open',
    title: 'Ready task',
    status: 'open',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '1',
  },
  {
    id: 'fake-done',
    title: 'Finished task',
    status: 'closed',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '0',
  },
];

const noopDetector = () => ({ stop() {} });

const settle = () => new Promise((r) => setTimeout(r, 20));

async function renderApp(columns: number, rows: number, closeIssue?: (id: string) => Promise<void>) {
  const store = createIssueStore(async () => issues);
  await store.refresh();
  const result = render(
    <App
      workspace={workspace}
      store={store}
      createDetector={noopDetector}
      initialDims={{ columns, rows }}
      closeIssue={closeIssue}
    />,
  );
  // let effects settle
  await settle();
  return result;
}

describe('App rendering', () => {
  it('renders side-by-side panes in a wide terminal (width > 2*height)', async () => {
    const { lastFrame, unmount } = await renderApp(120, 30);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('┌─ Active Tasks ─'); // label sits on the top border
    expect(frame).toContain('fake-wip');
    expect(frame).not.toContain('fake-done'); // closed hidden by default
    // side-by-side: detail content starts right of the list pane (40% of 120)
    const detailRow = frame.split('\n').find((l) => l.includes('ID: fake-wip')) ?? '';
    expect(detailRow.indexOf('ID: fake-wip')).toBeGreaterThan(40);
    // both pane top borders share the first row
    const topRow = frame.split('\n')[0] ?? '';
    expect(topRow).toContain('┌─ Active Tasks ─');
    expect(topRow).toContain('┌─ ke-wip ─');
    expect(frame).toContain('fake · server · LOCAL');
    expect(frame).toContain('⚪ open');
    expect(frame).toContain('q:quit');
    unmount();
  });

  it('renders stacked panes in a tall terminal', async () => {
    const { lastFrame, unmount } = await renderApp(80, 50);
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const listLine = lines.findIndex((l) => l.includes('⏳ fake-wip'));
    const detailLine = lines.findIndex((l) => l.includes('ID: fake-wip'));
    expect(listLine).toBeGreaterThan(-1);
    expect(detailLine).toBeGreaterThan(listLine); // detail strictly below the list
    // stacked: detail content starts at the left edge (inside the border)
    const detailRow = lines[detailLine] ?? '';
    expect(detailRow.indexOf('ID: fake-wip')).toBeLessThan(5);
    unmount();
  });

  it('shows the detail pane fields for the selected (first) issue', async () => {
    const { lastFrame, unmount } = await renderApp(120, 40);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ID: fake-wip');
    expect(frame).toContain('Status: in_progress');
    expect(frame).toContain('Priority: P1');
    expect(frame).toContain('Assignee: jon');
    unmount();
  });
});

describe('close confirmation modal', () => {
  it('opens on c, replacing the body', async () => {
    const { stdin, lastFrame, unmount } = await renderApp(100, 30);
    stdin.write('c');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Close fake-wip?');
    expect(frame).toContain('Working on it');
    expect(frame).toContain('y: close    n/Esc: cancel');
    expect(frame).not.toContain('Active Tasks'); // body swapped out
    unmount();
  });

  it('y confirms: runs the close command, flashes, and refreshes', async () => {
    const closed: string[] = [];
    const { stdin, lastFrame, unmount } = await renderApp(100, 30, async (id) => {
      closed.push(id);
    });
    stdin.write('c');
    await settle();
    stdin.write('y');
    await settle();
    expect(closed).toEqual(['fake-wip']);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Close fake-wip?');
    expect(frame).toContain('Closed fake-wip'); // status-bar flash
    unmount();
  });

  it('flashes the bd error when the close command fails', async () => {
    const { stdin, lastFrame, unmount } = await renderApp(100, 30, async () => {
      throw new Error('lock held by another bd process');
    });
    stdin.write('c');
    await settle();
    stdin.write('y');
    await settle();
    expect(lastFrame() ?? '').toContain('Close failed: lock held by another bd process');
    unmount();
  });

  it('n and Esc cancel without closing; other keys are swallowed', async () => {
    const closed: string[] = [];
    const { stdin, lastFrame, unmount } = await renderApp(100, 30, async (id) => {
      closed.push(id);
    });
    for (const cancelKey of ['n', '\x1b']) {
      stdin.write('c');
      await settle();
      expect(lastFrame() ?? '').toContain('Close fake-wip?');
      stdin.write('j'); // swallowed: must not move the selection
      await settle();
      expect(lastFrame() ?? '').toContain('Close fake-wip?');
      stdin.write(cancelKey);
      await settle();
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Close fake-wip?');
      expect(frame).toContain('Active Tasks'); // body restored
      expect(frame).toContain('ID: fake-wip'); // selection unchanged
    }
    expect(closed).toEqual([]);
    unmount();
  });

  it('flashes instead of opening the modal for an already-closed issue', async () => {
    const closed: string[] = [];
    const { stdin, lastFrame, unmount } = await renderApp(100, 30, async (id) => {
      closed.push(id);
    });
    stdin.write('a'); // show closed
    await settle();
    stdin.write('j');
    await settle();
    stdin.write('j'); // fake-done sorts last
    await settle();
    stdin.write('c');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('fake-done is already closed');
    expect(frame).not.toContain('Close fake-done?');
    expect(closed).toEqual([]);
    unmount();
  });
});
