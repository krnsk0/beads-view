import {
  blockingDeps,
  borderTopLine,
  bucketOf,
  closeModalLines,
  computeListWindow,
  detailLines,
  displayWidth,
  filterIssues,
  formatRowLines,
  legendText,
  overflowLine,
  rowChip,
  shortId,
  snapshotOf,
  sortIssues,
  statusById,
  titleOf,
  wrapText,
  wrapTitleForRow,
} from '../logic';
import type { Issue } from '../types';
import { describe, expect, it } from 'bun:test';

function issue(overrides: Partial<Issue> & { id: string }): Issue {
  return { status: 'open', ...overrides };
}

const dep = (issue_id: string, depends_on_id: string, type = 'blocks') => ({
  issue_id,
  depends_on_id,
  type,
});

describe('bucketOf', () => {
  it('classifies raw statuses', () => {
    const byId = new Map<string, string>();
    expect(bucketOf(issue({ id: 'a', status: 'closed' }), byId)).toBe('closed');
    expect(bucketOf(issue({ id: 'a', status: 'blocked' }), byId)).toBe('blocked');
    expect(bucketOf(issue({ id: 'a', status: 'in_progress' }), byId)).toBe('in_progress');
    expect(bucketOf(issue({ id: 'a', status: 'open' }), byId)).toBe('open');
  });

  it('treats open with an unresolved blocking dep as blocked', () => {
    const issues = [
      issue({ id: 'a', dependencies: [dep('a', 'b')] }),
      issue({ id: 'b', status: 'open' }),
    ];
    expect(bucketOf(issues[0] as Issue, statusById(issues))).toBe('blocked');
  });

  it('does not treat parent-child deps or deps on closed issues as blocking', () => {
    const issues = [
      issue({ id: 'a', dependencies: [dep('a', 'epic1', 'parent-child')] }),
      issue({ id: 'c', dependencies: [dep('c', 'd')] }),
      issue({ id: 'd', status: 'closed' }),
    ];
    const byId = statusById(issues);
    expect(bucketOf(issues[0] as Issue, byId)).toBe('open');
    expect(bucketOf(issues[1] as Issue, byId)).toBe('open');
  });

  it('keeps in_progress with dependencies as in_progress', () => {
    const issues = [
      issue({ id: 'a', status: 'in_progress', dependencies: [dep('a', 'b')] }),
      issue({ id: 'b' }),
    ];
    expect(bucketOf(issues[0] as Issue, statusById(issues))).toBe('in_progress');
  });

  it('falls back to dependency_count when the dependencies array is absent', () => {
    expect(bucketOf(issue({ id: 'a', dependency_count: 2 }), new Map())).toBe('blocked');
  });
});

describe('blockingDeps', () => {
  it('lists unresolved non-parent-child dep ids', () => {
    const issues = [
      issue({
        id: 'a',
        dependencies: [dep('a', 'b'), dep('a', 'c'), dep('a', 'p', 'parent-child')],
      }),
      issue({ id: 'b' }),
      issue({ id: 'c', status: 'closed' }),
    ];
    expect(blockingDeps(issues[0] as Issue, statusById(issues))).toEqual(['b']);
  });

  it('treats deps on unknown issues as blocking', () => {
    const i = issue({ id: 'a', dependencies: [dep('a', 'ghost')] });
    expect(blockingDeps(i, new Map())).toEqual(['ghost']);
  });
});

describe('sortIssues', () => {
  it('orders in_progress, open, blocked, closed; newest-first within buckets', () => {
    const issues = [
      issue({ id: 'old-open', created_at: '2026-01-01T00:00:00Z' }),
      issue({ id: 'closed', status: 'closed', created_at: '2026-06-01T00:00:00Z' }),
      issue({ id: 'new-open', created_at: '2026-05-01T00:00:00Z' }),
      issue({ id: 'wip', status: 'in_progress', created_at: '2026-02-01T00:00:00Z' }),
      issue({ id: 'blk', status: 'blocked', created_at: '2026-03-01T00:00:00Z' }),
    ];
    expect(sortIssues(issues).map((i) => i.id)).toEqual([
      'wip',
      'new-open',
      'old-open',
      'blk',
      'closed',
    ]);
  });
});

describe('filterIssues', () => {
  const issues = [
    issue({ id: 'p-abc', title: 'Fix uploader' }),
    issue({ id: 'p-def', title: 'Migrate DB', status: 'closed' }),
    issue({ id: 'p-ghi', title: 'UPLOAD retry' }),
  ];

  it('hides closed by default and shows them when toggled', () => {
    expect(filterIssues(issues, false).map((i) => i.id)).toEqual(['p-abc', 'p-ghi']);
    expect(filterIssues(issues, true).map((i) => i.id)).toEqual(['p-abc', 'p-def', 'p-ghi']);
  });
});

describe('titleOf', () => {
  it('strips a leading bracketed prefix', () => {
    expect(titleOf(issue({ id: 'a', title: '[multipart_upload] Fix retry logic' }))).toBe(
      'Fix retry logic',
    );
  });

  it('leaves titles with no bracket prefix untouched', () => {
    expect(titleOf(issue({ id: 'a', title: 'Fix retry logic' }))).toBe('Fix retry logic');
  });

  it('only strips a single leading prefix, not brackets mid-title', () => {
    expect(titleOf(issue({ id: 'a', title: '[proj] Handle [edge case]' }))).toBe(
      'Handle [edge case]',
    );
  });

  it('falls back to (untitled) for a missing title', () => {
    expect(titleOf(issue({ id: 'a' }))).toBe('(untitled)');
  });
});

describe('rowChip', () => {
  it('defaults to P2 with no assignee', () => {
    expect(rowChip(issue({ id: 'a' }))).toBe('P2');
  });

  it('includes priority and assignee', () => {
    expect(rowChip(issue({ id: 'a', priority: 1, assignee: 'jon' }))).toBe('P1 @jon');
  });
});

describe('wrapTitleForRow', () => {
  it('keeps a short title on one line', () => {
    expect(wrapTitleForRow('Fix uploader', 20, 30)).toEqual(['Fix uploader']);
  });

  it('wraps onto a second line using the wider full width', () => {
    const lines = wrapTitleForRow('Fix the uploader retry logic for large files', 15, 30);
    expect(lines.length).toBe(2);
    expect(displayWidth(lines[0] ?? '')).toBeLessThanOrEqual(15);
    expect(displayWidth(lines[1] ?? '')).toBeLessThanOrEqual(30);
  });

  it('truncates with an ellipsis when the title needs more than 2 lines', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve';
    const lines = wrapTitleForRow(long, 10, 10);
    expect(lines.length).toBe(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('hard-breaks a single word wider than the line', () => {
    const lines = wrapTitleForRow('supercalifragilisticexpialidocious', 10, 10);
    expect(lines).toEqual(['supercalif', 'ragilisti…']);
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(10);
  });
});

describe('formatRowLines', () => {
  it('drops the id and leads with the status glyph', () => {
    const lines = formatRowLines(issue({ id: 'p-secret-id', title: 'Fix uploader' }), new Map(), 40);
    expect(lines[0]?.startsWith('⚪ ')).toBe(true);
    expect(lines.join('\n')).not.toContain('p-secret-id');
  });

  it('strips a bracketed title prefix', () => {
    const lines = formatRowLines(
      issue({ id: 'a', title: '[multipart_upload] Fix retry logic' }),
      new Map(),
      40,
    );
    expect(lines.join(' ')).not.toContain('[multipart_upload]');
    expect(lines.join(' ')).toContain('Fix retry logic');
  });

  it('right-aligns the priority chip on the first line at an exact width', () => {
    const lines = formatRowLines(
      issue({ id: 'a', title: 'Ship it', priority: 1 }),
      new Map(),
      30,
    );
    expect(lines).toHaveLength(1);
    // prefix "⚪ " (3 cols) + "Ship it" (7) + gap + "[P1]" (4) === 30 cols exactly.
    expect(lines[0]).toBe(`⚪ Ship it${' '.repeat(30 - 3 - 7 - 4)}[P1]`);
    expect(displayWidth(lines[0] ?? '')).toBe(30);
  });

  it('combines priority and assignee in the chip', () => {
    const lines = formatRowLines(
      issue({ id: 'a', title: 'Ship it', priority: 3, assignee: 'jon' }),
      new Map(),
      30,
    );
    expect(lines[0]).toBe(`⚪ Ship it${' '.repeat(30 - 3 - 7 - 9)}[P3 @jon]`);
    expect(displayWidth(lines[0] ?? '')).toBe(30);
  });

  it('prefixes epics before the title', () => {
    const lines = formatRowLines(
      issue({ id: 'a', title: 'Big rollout', issue_type: 'epic' }),
      new Map(),
      40,
    );
    expect(lines[0]?.includes('EPIC Big rollout')).toBe(true);
  });

  it('wraps a long title onto a second indented line, chip only on the first', () => {
    const lines = formatRowLines(
      issue({ id: 'a', title: 'A rather long title that needs to wrap across two lines' }),
      new Map(),
      30,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[P2]');
    expect(lines[1]).not.toContain('[P2]');
    expect(lines[1]?.startsWith('  ')).toBe(true); // indented under the title, past the icon prefix
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(30);
  });
});

describe('overflowLine', () => {
  it('formats the remaining count', () => {
    expect(overflowLine(3)).toBe('  3 more…');
  });
});

describe('computeListWindow', () => {
  it('shows everything with no overflow when it all fits', () => {
    const w = computeListWindow([1, 1, 1], 0, 5, 0);
    expect(w).toEqual({ startIndex: 0, endIndex: 3, overflow: 0 });
  });

  it('reserves a line for the overflow indicator when rows remain', () => {
    // 5 single-line rows, 3 lines of budget -> 2 fit, 1 line reserved for "N more".
    const w = computeListWindow([1, 1, 1, 1, 1], 0, 3, 0);
    expect(w).toEqual({ startIndex: 0, endIndex: 2, overflow: 3 });
  });

  it('scrolls down just enough to reveal a selection below the window', () => {
    const w = computeListWindow([1, 1, 1, 1, 1], 4, 3, 0);
    expect(w.endIndex).toBe(5);
    expect(w.startIndex).toBeLessThanOrEqual(4);
    expect(4).toBeGreaterThanOrEqual(w.startIndex);
    expect(4).toBeLessThan(w.endIndex);
  });

  it('scrolls up immediately when the selection moves above the window', () => {
    const w = computeListWindow([1, 1, 1, 1, 1], 0, 3, 3);
    expect(w.startIndex).toBe(0);
  });

  it('accounts for 2-line rows when fitting the budget', () => {
    // rows of height [2, 2, 1]; budget 3 -> only the first 2-line row fits before overflow.
    const w = computeListWindow([2, 2, 1], 0, 3, 0);
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(1);
    expect(w.overflow).toBe(2);
  });

  it('never hides the selection even under a very tight budget', () => {
    const w = computeListWindow([2, 2, 2], 2, 2, 0);
    expect(2).toBeGreaterThanOrEqual(w.startIndex);
    expect(2).toBeLessThan(w.endIndex);
  });

  it('returns an empty window for an empty list', () => {
    expect(computeListWindow([], 0, 5, 0)).toEqual({ startIndex: 0, endIndex: 0, overflow: 0 });
  });
});

describe('detailLines', () => {
  it('renders title, fields, blocked-by, and description', () => {
    const issues = [
      issue({
        id: 'p-abc123',
        title: 'Do a thing',
        status: 'open',
        dependencies: [dep('p-abc123', 'p-xyz')],
        labels: ['needs-review'],
        assignee: 'jon',
        description: 'Body text',
      }),
      issue({ id: 'p-xyz' }),
    ];
    const { lines, boldUntil } = detailLines(issues[0] as Issue, 60, statusById(issues));
    expect(boldUntil).toBe(1);
    expect(lines[0]).toBe('Do a thing');
    expect(lines).toContain('ID: p-abc123');
    expect(lines).toContain('Priority: P2');
    expect(lines).toContain('Assignee: jon');
    expect(lines).toContain('Labels: needs-review');
    expect(lines).toContain('Blocked by: p-xyz');
    expect(lines[lines.length - 1]).toBe('Body text');
  });

  it('prefixes epics and defaults description', () => {
    const { lines } = detailLines(
      issue({ id: 'p-1', title: 'Big', issue_type: 'epic' }),
      60,
      new Map(),
    );
    expect(lines[0]).toBe('EPIC: Big');
    expect(lines[lines.length - 1]).toBe('(no description)');
  });
});

describe('wrapText', () => {
  it('wraps at word boundaries and preserves newlines', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('a\nb', 10)).toEqual(['a', 'b']);
  });

  it('hard-breaks overlong words', () => {
    expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
  });
});

describe('snapshotOf', () => {
  it('changes when status or updated_at changes', () => {
    const a = [issue({ id: 'x', updated_at: '1' })];
    const b = [issue({ id: 'x', updated_at: '2' })];
    expect(snapshotOf(a)).not.toBe(snapshotOf(b));
    expect(snapshotOf(a)).toBe(snapshotOf([issue({ id: 'x', updated_at: '1' })]));
  });
});

describe('chrome helpers', () => {
  it('shortId takes the last 6 chars', () => {
    expect(shortId('pine1-abc123')).toBe('abc123');
  });

  it('legend appends closed only when visible', () => {
    expect(legendText(false)).not.toContain('closed');
    expect(legendText(true)).toContain('✅ closed');
  });
});

describe('closeModalLines', () => {
  it('renders prompt, title, and key hints', () => {
    const lines = closeModalLines(issue({ id: 'p-abc', title: 'Ship it' }), 40);
    expect(lines).toEqual(['Close p-abc?', 'Ship it', '', 'y: close    n/Esc: cancel']);
  });

  it('truncates long titles with an ellipsis', () => {
    const lines = closeModalLines(issue({ id: 'p-abc', title: 'A very long title indeed' }), 10);
    expect(lines[1]).toBe('A very lo…');
    expect(displayWidth(lines[1] ?? '')).toBeLessThanOrEqual(10);
  });
});

describe('borderTopLine', () => {
  it('embeds the label and pads to the exact width', () => {
    const line = borderTopLine(' Active Tasks ', 24);
    expect(line).toBe('┌─ Active Tasks ───────┐');
    expect(displayWidth(line)).toBe(24);
  });

  it('truncates the label when the pane is narrow', () => {
    const line = borderTopLine(' A Very Long Pane Label ', 12);
    expect(displayWidth(line)).toBe(12);
    expect(line.startsWith('┌─ A Very')).toBe(true);
    expect(line.endsWith('┐')).toBe(true);
  });

  it('degrades to plain dashes below the minimum width', () => {
    expect(borderTopLine(' X ', 3)).toBe('───');
  });
});
