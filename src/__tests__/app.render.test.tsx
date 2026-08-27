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

describe('App rendering (stacked-only layout)', () => {
  it('stacks list above detail in a full-right-pane-sized terminal (~110+ cols)', async () => {
    const { lastFrame, unmount } = await renderApp(120, 30);
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    expect(frame).toContain('┌─ Active Tasks ─'); // label sits on the top border
    const listLine = lines.findIndex((l) => l.includes('Working on it'));
    const detailLine = lines.findIndex((l) => l.includes('ID: fake-wip'));
    expect(listLine).toBeGreaterThan(-1);
    expect(detailLine).toBeGreaterThan(listLine); // detail strictly below the list, always
    // the id shows (dim) at the start of the row, right after the status glyph
    expect(lines[listLine] ?? '').toContain('⏳ fake-wip Working on it');
    // priority + assignee render as a bracketed chip on the row
    expect(lines[listLine] ?? '').toContain('[P1 @jon]');
    expect(frame).not.toContain('fake-done'); // closed hidden by default
    expect(frame).toContain('fake · server · LOCAL');
    expect(frame).toContain('⚪ open');
    expect(frame).toContain('q:quit');
    unmount();
  });

  it('stays usable stacked at a half-right cmux pane width (~70 cols)', async () => {
    const { lastFrame, unmount } = await renderApp(70, 40);
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const listLine = lines.findIndex((l) => l.includes('Working on it'));
    const detailLine = lines.findIndex((l) => l.includes('ID: fake-wip'));
    expect(listLine).toBeGreaterThan(-1);
    expect(detailLine).toBeGreaterThan(listLine); // still stacked, list above detail
    expect(lines[listLine] ?? '').toContain('⏳ fake-wip Working on it'); // id still visible, narrow pane too
    expect(lines[listLine] ?? '').toContain('[P1 @jon]');
    unmount();
  });

  it('wraps a long title onto a second row line without repeating the chip', async () => {
    const longTitleIssues: Issue[] = [
      {
        id: 'fake-long',
        title: 'A rather long title that should need to wrap onto a second line',
        status: 'open',
        priority: 1,
        created_at: '2026-07-03T00:00:00Z',
        updated_at: '3',
      },
    ];
    const store = createIssueStore(async () => longTitleIssues);
    await store.refresh();
    const { lastFrame, unmount } = render(
      <App
        workspace={workspace}
        store={store}
        createDetector={noopDetector}
        initialDims={{ columns: 40, rows: 30 }}
      />,
    );
    await settle();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const chipLine = lines.findIndex((l) => l.includes('[P1]'));
    expect(chipLine).toBeGreaterThan(-1);
    expect(lines[chipLine] ?? '').toContain('fake-long'); // id shows on the first line
    // the wrapped continuation line carries more title text but not another chip or id
    const continuationLine = lines[chipLine + 1] ?? '';
    expect(continuationLine).not.toContain('[P1]');
    expect(continuationLine).not.toContain('fake-long');
    unmount();
  });

  it('shows an overflow indicator when more rows exist than fit', async () => {
    const manyIssues: Issue[] = Array.from({ length: 30 }, (_, i) => ({
      id: `fake-${i}`,
      title: `Task number ${i}`,
      status: 'open',
      created_at: `2026-07-01T00:00:0${i % 10}Z`,
      updated_at: String(i),
    }));
    const store = createIssueStore(async () => manyIssues);
    await store.refresh();
    const { lastFrame, unmount } = render(
      <App
        workspace={workspace}
        store={store}
        createDetector={noopDetector}
        initialDims={{ columns: 80, rows: 20 }}
      />,
    );
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\d+ more…/);
    unmount();
  });

  it('shrinks the list pane to its rows so a short queue feeds the detail pane', async () => {
    const { lastFrame, unmount } = await renderApp(80, 40);
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // Two visible one-line rows + the two border rows: the list closes at
    // line 3 and the detail pane starts right under it, instead of the list
    // holding a fixed ~60% share of a 40-row terminal around 2 rows of tasks.
    expect(lines[3] ?? '').toContain('└');
    const detailLine = lines.findIndex((l) => l.includes('ID: fake-wip'));
    expect(detailLine).toBeGreaterThan(3);
    expect(detailLine).toBeLessThan(12);
    unmount();
  });

  it('still caps the list at ~60% of the body when the queue is long', async () => {
    const manyIssues: Issue[] = Array.from({ length: 30 }, (_, i) => ({
      id: `fake-${i}`,
      title: `Task number ${i}`,
      status: 'open',
      created_at: `2026-07-01T00:00:0${i % 10}Z`,
      updated_at: String(i),
    }));
    const store = createIssueStore(async () => manyIssues);
    await store.refresh();
    const { lastFrame, unmount } = render(
      <App
        workspace={workspace}
        store={store}
        createDetector={noopDetector}
        initialDims={{ columns: 80, rows: 30 }}
      />,
    );
    await settle();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    // bodyH = 28, so the list may take at most round(28 * 0.6) = 17 rows;
    // the detail pane must still get its share below.
    const detailLine = lines.findIndex((l) => l.includes('ID: fake-'));
    expect(detailLine).toBeGreaterThan(16);
    expect(frame).toMatch(/\d+ more…/);
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

  it('shows a 2-line selected row FIRST line when the list pane has a single content line', async () => {
    const tall: Issue[] = [
      {
        id: 'p-wrap',
        title: 'A rather long title that certainly wraps onto a second line here',
        status: 'in_progress',
        created_at: '2',
        updated_at: '2',
      },
      { id: 'p-short', title: 'Short', status: 'open', created_at: '1', updated_at: '1' },
    ];
    const store = createIssueStore(async () => tall);
    // rows=8 → bodyH=6 → listH=3 → one content line; the selected row wraps to 2.
    const { lastFrame, unmount } = render(
      <App workspace={workspace} store={store} initialDims={{ columns: 40, rows: 8 }} />,
    );
    await settle();
    const lines = (lastFrame() ?? '').split('\n');
    const header = lines.findIndex((l) => l.includes('Active Tasks'));
    const content = lines[header + 1] ?? '';
    // The row's first line (id + title head) is the visible one — never the
    // continuation line or a composite with the overflow indicator.
    expect(content).toContain('p-wrap A rather');
    expect(content).not.toContain('more…');
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
