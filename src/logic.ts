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

/**
 * Bead titles shouldn't carry a `[project]`-style bracketed prefix (beads are
 * already per-project; that tag style is reserved for a model distinguishing
 * sub-initiatives within one project — decision 77). The data migration
 * strips these at the source; this is a defensive render-time backstop for
 * anything that slips through.
 */
const BRACKET_PREFIX = /^\[[^\]]*\]\s*/;

export function titleOf(issue: Issue): string {
  const title = issue.title || '(untitled)';
  return title.replace(BRACKET_PREFIX, '');
}

export function isEpic(issue: Issue): boolean {
  return issue.issue_type === 'epic';
}

/** Compact chip text: priority, plus assignee when present, e.g. "P1", "P1 @jon". */
export function rowChip(issue: Issue): string {
  const priority = `P${issue.priority ?? 2}`;
  return issue.assignee ? `${priority} @${issue.assignee}` : priority;
}

/**
 * Greedily fills `width` cells with whole words from `words` (hard-breaking
 * a single word wider than `width`), returning the fitted line and whatever
 * words didn't fit.
 */
function greedyWrapWords(words: string[], width: number): { line: string; rest: string[] } {
  const budget = Math.max(1, width);
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i] as string;
    const candidate = line ? `${line} ${word}` : word;
    if (displayWidth(candidate) <= budget) {
      line = candidate;
      continue;
    }
    if (line !== '') break;
    // The word alone is wider than the budget: hard-break it so we still make progress.
    let take = word;
    while (take.length > 1 && displayWidth(take) > budget) take = take.slice(0, -1);
    const remainder = word.slice(take.length);
    return { line: take, rest: remainder ? [remainder, ...words.slice(i + 1)] : words.slice(i + 1) };
  }
  return { line, rest: words.slice(i) };
}

/**
 * Wraps a title into at most 2 lines for a list row: line 1 is narrowed
 * (to leave room for the trailing chip), line 2 (if needed) gets the full
 * row width. Text that still doesn't fit in 2 lines is truncated on line 2
 * with an ellipsis.
 */
export function wrapTitleForRow(title: string, firstWidth: number, fullWidth: number): string[] {
  const words = title.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const first = greedyWrapWords(words, firstWidth);
  if (first.rest.length === 0) return [first.line];
  const second = greedyWrapWords(first.rest, fullWidth);
  if (second.rest.length === 0) return [first.line, second.line];
  let truncated = second.line;
  const maxWidth = Math.max(0, fullWidth - 1);
  while (truncated.length > 0 && displayWidth(truncated) > maxWidth) truncated = truncated.slice(0, -1);
  return [first.line, `${truncated}…`];
}

/** A run of row text; `dim` marks the id span so the title still dominates visually. */
export interface RowSegment {
  text: string;
  dim?: boolean;
}

/**
 * Whether a row segment should actually render dim. Ink/chalk's dim-close
 * SGR code (22, "normal intensity") also resets bold, since bold and dim
 * share one attribute in real terminals — so a dim segment sitting inside an
 * otherwise-bold (selected) row silently strips bold from whatever follows
 * it on that line, with no code left to reassert it. Selected rows are
 * already visually distinct (inverted colors), so they skip dimming rather
 * than risk that: never combine dim with bold on the same segment.
 */
export function shouldDimSegment(seg: RowSegment, isSelected: boolean): boolean {
  return Boolean(seg.dim) && !isSelected;
}

export interface RowLine {
  segments: RowSegment[];
}

/** Flattens a row line's segments to plain text (for tests and width math). */
export function rowLineText(line: RowLine): string {
  return line.segments.map((s) => s.text).join('');
}

/**
 * List row lines, pre-wrapped to `width`: `<icon> [EPIC ]<id> <title>` (title
 * wraps to at most 2 lines) with a compact right-aligned `[priority]` chip on
 * the first line. The id renders dim (a segment flagged `dim: true`) so the
 * title still dominates, but stays visible since models refer to beads by
 * id. Wrapped continuation lines are plain and indent past the id so title
 * text stays aligned.
 */
export function formatRowLines(issue: Issue, byId: Map<string, string>, width: number): RowLine[] {
  const icon = ICONS[bucketOf(issue, byId)];
  const epic = isEpic(issue) ? 'EPIC ' : '';
  const prefix = `${icon} ${epic}`;
  const idSeg = `${issue.id} `;
  const indentWidth = displayWidth(prefix) + displayWidth(idSeg);
  const chip = `[${rowChip(issue)}]`;
  const chipWidth = displayWidth(chip);
  const bodyWidth = Math.max(1, width - indentWidth);
  const firstWidth = Math.max(1, bodyWidth - chipWidth - 1);

  const titleLines = wrapTitleForRow(titleOf(issue), firstWidth, bodyWidth);
  const firstLine = titleLines[0] as string;
  const gap = Math.max(1, bodyWidth - displayWidth(firstLine) - chipWidth);
  const line1: RowLine = {
    segments: [
      { text: prefix },
      { text: idSeg, dim: true },
      { text: `${firstLine}${' '.repeat(gap)}${chip}` },
    ],
  };
  if (titleLines.length < 2) return [line1];
  const line2: RowLine = { segments: [{ text: `${' '.repeat(indentWidth)}${titleLines[1]}` }] };
  return [line1, line2];
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

export interface ListWindow {
  /** Index (into the caller's row-line-count array) of the first row to render. */
  startIndex: number;
  /** Exclusive end index of the rows to render. */
  endIndex: number;
  /** Rows below the window that didn't fit, for an "N more" indicator. */
  overflow: number;
}

/**
 * Picks which rows fit within `maxLines` terminal lines given each row's
 * rendered line count (rows can wrap to 2 lines), keeping `selectedIndex`
 * visible and reserving one line for an overflow indicator when rows remain
 * below the window. Mirrors the old single-line-per-row scroll behavior
 * (scroll up immediately when the selection moves above the window; scroll
 * down just enough to reveal it otherwise) generalized to variable row
 * heights.
 */
export function computeListWindow(
  lineCounts: number[],
  selectedIndex: number,
  maxLines: number,
  prevStart: number,
): ListWindow {
  const n = lineCounts.length;
  if (n === 0) return { startIndex: 0, endIndex: 0, overflow: 0 };
  const clamp = (v: number) => Math.max(0, Math.min(v, n - 1));
  const sel = clamp(selectedIndex);

  const fitEnd = (from: number, budget: number): number => {
    let used = 0;
    let end = from;
    while (end < n && used + (lineCounts[end] as number) <= budget) {
      used += lineCounts[end] as number;
      end++;
    }
    return end;
  };

  let start = clamp(prevStart);
  if (sel < start) {
    start = sel;
  } else if (sel >= fitEnd(start, maxLines)) {
    // Scroll down just enough to bring the selection into view.
    let candidate = start;
    while (candidate < sel && sel >= fitEnd(candidate, maxLines)) candidate++;
    start = candidate;
  }

  let end = fitEnd(start, maxLines);
  if (end < n) {
    // Reserve one line for the overflow indicator, but never hide the
    // selection to make room for it.
    end = fitEnd(start, Math.max(0, maxLines - 1));
    if (sel >= end) end = sel + 1;
  }
  return { startIndex: start, endIndex: end, overflow: Math.max(0, n - end) };
}

/** The list's overflow-indicator line, e.g. "  3 more…". */
export function overflowLine(count: number): string {
  return `  ${count} more…`;
}
