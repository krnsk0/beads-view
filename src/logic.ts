import type { Bucket, Issue } from './types';

export const ICONS: Record<Bucket, string> = {
  open: '⚪',
  in_progress: '⏳',
  blocked: '⛔',
  closed: '✅',
};

const BUCKET_RANK: Record<Bucket, number> = {
  in_progress: 0,
  open: 1,
  blocked: 2,
  closed: 3,
};

/**
 * Dependency ids that actually block this issue: non-parent-child edges whose
 * target issue is not closed. An edge pointing at an unknown issue (not in the
 * loaded set) is treated as unresolved, i.e. still blocking.
 */
export function blockingDeps(issue: Issue, statusById: Map<string, string>): string[] {
  const deps = issue.dependencies ?? [];
  return deps
    .filter((d) => d.issue_id === issue.id && d.type !== 'parent-child')
    .map((d) => d.depends_on_id)
    .filter((id) => statusById.get(id) !== 'closed');
}

/**
 * Classify an issue into the bucket that drives icons, sorting, and the
 * legend. "blocked" covers both explicit status=blocked and open issues with
 * unresolved blocking dependencies. in_progress with dependencies still
 * counts as in_progress. When the dependencies array is absent, falls back to
 * dependency_count (older bd schemas).
 */
export function bucketOf(issue: Issue, statusById: Map<string, string>): Bucket {
  if (issue.status === 'closed') return 'closed';
  if (issue.status === 'blocked') return 'blocked';
  if (issue.status === 'in_progress') return 'in_progress';
  if (issue.dependencies) {
    if (blockingDeps(issue, statusById).length > 0) return 'blocked';
  } else if ((issue.dependency_count ?? 0) > 0) {
    return 'blocked';
  }
  return 'open';
}

export function statusById(issues: Issue[]): Map<string, string> {
  return new Map(issues.map((i) => [i.id, i.status]));
}

/**
 * Sort for display: in_progress, then open (ready), then blocked, then
 * closed; newest-first (created_at desc) within each bucket.
 */
export function sortIssues(issues: Issue[]): Issue[] {
  const byId = statusById(issues);
  return issues
    .map((issue, idx) => ({ issue, idx }))
    .sort((a, b) => {
      const rank = BUCKET_RANK[bucketOf(a.issue, byId)] - BUCKET_RANK[bucketOf(b.issue, byId)];
      if (rank !== 0) return rank;
      const at = a.issue.created_at ?? '';
      const bt = b.issue.created_at ?? '';
      if (at !== bt) return at > bt ? -1 : 1;
      return a.idx - b.idx;
    })
    .map(({ issue }) => issue);
}

/** Client-side filter: show/hide closed issues. */
export function filterIssues(issues: Issue[], showClosed: boolean): Issue[] {
  return issues.filter((i) => showClosed || i.status !== 'closed');
}

export function titleOf(issue: Issue): string {
  return issue.title || '(untitled)';
}

export function isEpic(issue: Issue): boolean {
  return issue.issue_type === 'epic';
}

/** List row: `<icon> [EPIC ]<id> <title> [P<n>] [@assignee]`. */
export function formatRow(issue: Issue, byId: Map<string, string>): string {
  const icon = ICONS[bucketOf(issue, byId)];
  const epic = isEpic(issue) ? 'EPIC ' : '';
  const priority = issue.priority !== undefined ? ` P${issue.priority}` : '';
  const assignee = issue.assignee ? ` @${issue.assignee}` : '';
  return `${icon} ${epic}${issue.id} ${titleOf(issue)}${priority}${assignee}`;
}

/**
 * Snapshot string used to decide whether a refetch actually changed anything
 * (same trick bd's own --watch uses): id:status:updated_at per issue.
 */
export function snapshotOf(issues: Issue[]): string {
  return issues.map((i) => `${i.id}:${i.status}:${i.updated_at ?? ''}`).join('\n');
}

/** Word-wrap plain text to a width, preserving existing newlines. */
export function wrapText(text: string, width: number): string[] {
  if (width < 1) return [text];
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length <= width) {
      out.push(raw);
      continue;
    }
    let line = '';
    for (const word of raw.split(' ')) {
      if (line === '') {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
      // hard-break words longer than the width
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

export interface DetailContent {
  lines: string[];
  /** Lines [0, boldUntil) are the title and render bold. */
  boldUntil: number;
}

/**
 * Detail-pane content as plain, pre-wrapped lines. Mirrors the old viewer's
 * layout (bold title, rule, fields, rule, description), plus a "Blocked by:"
 * line listing unresolved blocking dependency ids.
 */
export function detailLines(issue: Issue, width: number, byId: Map<string, string>): DetailContent {
  const rule = '─'.repeat(Math.max(1, Math.min(33, width)));
  const title = isEpic(issue) ? `EPIC: ${titleOf(issue)}` : titleOf(issue);
  const lines: string[] = [...wrapText(title, width)];
  const boldUntil = lines.length;
  lines.push(rule);
  lines.push(`ID: ${issue.id}`);
  lines.push(`Status: ${issue.status}`);
  lines.push(`Type: ${issue.issue_type || 'task'}`);
  lines.push(`Priority: P${issue.priority ?? 2}`);
  if (issue.assignee) lines.push(`Assignee: ${issue.assignee}`);
  if (issue.labels?.length) lines.push(...wrapText(`Labels: ${issue.labels.join(', ')}`, width));
  const blockers = blockingDeps(issue, byId);
  if (blockers.length > 0) lines.push(...wrapText(`Blocked by: ${blockers.join(', ')}`, width));
  lines.push(rule);
  lines.push('');
  lines.push(...wrapText(issue.description || '(no description)', width));
  return { lines, boldUntil };
}

/** Last 6 characters of the id, used as the detail pane's label. */
export function shortId(id: string): string {
  return id.slice(-6);
}

export function legendText(showClosed: boolean): string {
  return ' ⚪ open  ⏳ in progress  ⛔ blocked' + (showClosed ? '  ✅ closed' : '');
}

export const STATUS_HINTS =
  ' ↑↓/jk:nav | Enter:copy id | c:close | Tab:focus | a:closed | r:refresh | q:quit';

/** Terminal display width (emoji render 2 cells wide; string length lies). */
export function displayWidth(s: string): number {
  const bunGlobal = (globalThis as { Bun?: { stringWidth?: (s: string) => number } }).Bun;
  if (bunGlobal?.stringWidth) return bunGlobal.stringWidth(s);
  return s.length;
}

/**
 * A pane's top border row with the label embedded in it, e.g.
 * `┌─ Active Tasks ────┐`, padded (or label-truncated) to exactly `width`
 * cells. Rendered as a plain text row above a Box with borderTop disabled,
 * because Ink borders can't carry titles.
 */
export function borderTopLine(label: string, width: number): string {
  if (width < 4) return '─'.repeat(Math.max(0, width));
  let lbl = label;
  const maxLabel = width - 3; // two corners + one leading dash
  while (lbl.length > 0 && displayWidth(lbl) > maxLabel) lbl = lbl.slice(0, -1);
  const fill = Math.max(0, width - 3 - displayWidth(lbl));
  return `┌─${lbl}${'─'.repeat(fill)}┐`;
}

/**
 * Content lines for the close-confirmation modal (line 0 renders bold). The
 * issue title is truncated with an ellipsis to the modal's inner width.
 */
export function closeModalLines(issue: Issue, innerWidth: number): string[] {
  let title = titleOf(issue);
  if (displayWidth(title) > innerWidth) {
    while (title.length > 0 && displayWidth(title) > Math.max(1, innerWidth - 1)) {
      title = title.slice(0, -1);
    }
    title += '…';
  }
  return [`Close ${issue.id}?`, title, '', 'y: close    n/Esc: cancel'];
}
