import path from 'node:path';
import { describe, expect, it } from 'bun:test';

// Ink/chalk decide color support once, at import time, for the whole
// process. Running inside the shared `bun test` process (after some other
// file has already pulled in ink/chalk) means setting FORCE_COLOR here would
// come too late. A fresh `bun` subprocess, with FORCE_COLOR set in its env
// before it even starts, is the only reliable way to force real ANSI output
// and see what the terminal will actually receive.
const fixture = path.join(import.meta.dir, 'fixtures', 'render-wrapped-selected-row.tsx');

function renderWithAnsi(): string {
  const proc = Bun.spawnSync({
    cmd: ['bun', fixture],
    env: { ...process.env, FORCE_COLOR: '3' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (!proc.success) {
    throw new Error(`fixture render failed: ${proc.stderr.toString()}`);
  }
  return JSON.parse(proc.stdout.toString()) as string;
}

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('row styling (ANSI, selected + wrapped title)', () => {
  it('applies bold identically to both lines of a wrapped, selected title', () => {
    const frame = renderWithAnsi();
    const lines = frame.split('\n');
    const firstLineIndex = lines.findIndex((l) => l.includes('A rather long title'));
    const firstLine = lines[firstLineIndex] ?? '';
    const secondLine = lines[firstLineIndex + 1] ?? '';
    expect(firstLine).not.toBe('');
    expect(secondLine).not.toBe('');

    // Each line is uniformly bold (selected row), so a correct render opens
    // bold (SGR 1) exactly once and closes intensity (SGR 22) exactly once,
    // both at the line's edges. The original bug — a dim id segment's
    // closing code (SGR 22, shared with bold's reset) killing bold partway
    // through line 1, with nothing left to reopen it — showed up as a
    // *second* SGR 22 on that line: one where dim closed (silently taking
    // bold with it) and one at the line's real end.
    for (const line of [firstLine, secondLine]) {
      expect(occurrences(line, '[1m')).toBe(1);
      expect(occurrences(line, '[22m')).toBe(1);
    }
  });

  it('does not dim the id on a selected row (dim would conflict with bold)', () => {
    const frame = renderWithAnsi();
    // The fix avoids ever combining dim with bold, rather than trying to
    // make chalk reassert bold after a dim segment closes.
    expect(frame).not.toContain('[2m');
  });
});
