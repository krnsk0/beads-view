import {
  blockingDeps,
  borderTopLine,
  bucketOf,
  closeModalLines,
  detailLines,
  displayWidth,
  filterIssues,
  formatRow,
  legendText,
  shortId,
  snapshotOf,
  sortIssues,
  statusById,
  wrapText,
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

describe('formatRow', () => {
  it('formats icon, epic prefix, id, title, priority, assignee', () => {
    const i = issue({
      id: 'p-1',
      title: 'Migrate uploader',
      status: 'in_progress',
      issue_type: 'epic',
      priority: 1,
      assignee: 'jon',
    });
    expect(formatRow(i, new Map())).toBe('⏳ EPIC p-1 Migrate uploader P1 @jon');
  });

  it('omits missing priority and assignee', () => {
    expect(formatRow(issue({ id: 'p-2', title: 'T' }), new Map())).toBe('⚪ p-2 T');
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
