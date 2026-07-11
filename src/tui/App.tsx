import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { closeIssue } from '../bd';
import { copyToClipboard } from '../clipboard';
import type { Detector } from '../detector';
import {
  borderTopLine,
  closeModalLines,
  detailLines,
  displayWidth,
  filterIssues,
  formatRow,
  legendText,
  STATUS_HINTS,
  shortId,
  sortIssues,
  statusById,
} from '../logic';
import type { IssueStore } from '../store';
import type { LiveStatus } from '../types';
import type { Workspace } from '../workspace';

export interface AppProps {
  workspace: Workspace;
  store: IssueStore;
  /** Change-detection factory; tests pass a noop. */
  createDetector?: (onTrigger: () => void, onStatus: (s: LiveStatus) => void) => Detector;
  /** Fixed dimensions for tests; defaults to the real stdout size. */
  initialDims?: { columns: number; rows: number };
  /** Close-issue command; tests pass a mock. Defaults to `bd close` at the workspace root. */
  closeIssue?: (id: string) => Promise<void>;
}

type Pane = 'list' | 'detail';

function useDimensions(initial?: { columns: number; rows: number }) {
  const { stdout } = useStdout();
  // Degenerate ptys can report 0x0; fall back to 80x24 so we always render.
  const read = () => ({
    columns: initial?.columns || stdout.columns || 80,
    rows: initial?.rows || stdout.rows || 24,
  });
  const [dims, setDims] = useState(read);
  useEffect(() => {
    if (initial) return;
    const onResize = () => setDims({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout, initial]);
  return dims;
}

/** Pad/truncate a bar's text to exactly the terminal width. */
function fitBar(left: string, right: string, width: number): string {
  const gap = width - displayWidth(left) - displayWidth(right);
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  return (left + ' ' + right).slice(0, Math.max(0, width));
}

export function App({
  workspace,
  store,
  createDetector,
  initialDims,
  closeIssue: closeIssueOverride,
}: AppProps) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { columns, rows } = useDimensions(initialDims);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const [showClosed, setShowClosed] = useState(false);
  const [focus, setFocus] = useState<Pane>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailScroll, setDetailScroll] = useState(0);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStatus>('manual');
  const lastIndexRef = useRef(0);
  const windowRef = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start change detection + initial load.
  useEffect(() => {
    void store.refresh();
    if (!createDetector) return;
    const detector = createDetector(() => void store.refresh(), setLive);
    return () => detector.stop();
  }, [store, createDetector]);

  const byId = statusById(state.issues);
  const visible = filterIssues(sortIssues(state.issues), showClosed);

  // Selection: follow the selected id across refreshes; fall back to the last
  // index (clamped) when it disappears.
  let selectedIndex = visible.findIndex((i) => i.id === selectedId);
  if (selectedIndex === -1) {
    selectedIndex = Math.max(0, Math.min(lastIndexRef.current, visible.length - 1));
  }
  const selected = visible[selectedIndex] ?? null;
  lastIndexRef.current = selectedIndex;

  // Sync selectedId when the effective selection drifted (e.g. issue vanished),
  // and reset detail scroll only when a *different* issue gets selected.
  const effectiveId = selected ? selected.id : null;
  useEffect(() => {
    if (effectiveId !== selectedId) {
      setSelectedId(effectiveId);
      setDetailScroll(0);
    }
  }, [effectiveId, selectedId]);

  const showFlash = useCallback((message: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(message);
    flashTimer.current = setTimeout(() => setFlash(null), 1500);
  }, []);

  // Auto-cancel a pending close confirmation when a refresh removes the
  // target issue or the selection changes underneath it.
  useEffect(() => {
    if (confirmCloseId && effectiveId !== confirmCloseId) setConfirmCloseId(null);
  }, [confirmCloseId, effectiveId]);

  const runClose = useCallback(
    (id: string) => {
      const close = closeIssueOverride ?? ((issueId: string) => closeIssue(workspace.root, issueId));
      close(id)
        .then(() => {
          showFlash(`Closed ${id}`);
          return store.refresh();
        })
        .catch((e) => showFlash(`Close failed: ${e instanceof Error ? e.message : e}`));
    },
    [closeIssueOverride, workspace.root, store, showFlash],
  );

  // Layout: side-by-side when width > 2 * height, stacked otherwise.
  const landscape = columns > rows * 2;
  const bodyH = Math.max(6, rows - 2);
  const listW = landscape ? Math.floor(columns * 0.4) : columns;
  const listH = landscape ? bodyH : Math.floor(bodyH * 0.4);
  const detailW = landscape ? columns - listW : columns;
  const detailH = landscape ? bodyH : bodyH - listH;

  // Inner content areas: 1 top-border label row + 1 bottom border row + side cols.
  const listInnerH = Math.max(1, listH - 2);
  const detailInnerH = Math.max(1, detailH - 2);
  const detailInnerW = Math.max(1, detailW - 2);

  // Keep the selection inside the visible window of the list.
  let winStart = windowRef.current;
  if (selectedIndex < winStart) winStart = selectedIndex;
  if (selectedIndex >= winStart + listInnerH) winStart = selectedIndex - listInnerH + 1;
  winStart = Math.max(0, Math.min(winStart, Math.max(0, visible.length - listInnerH)));
  windowRef.current = winStart;
  const windowIssues = visible.slice(winStart, winStart + listInnerH);

  const detail = selected ? detailLines(selected, detailInnerW, byId) : null;
  const maxScroll = detail ? Math.max(0, detail.lines.length - detailInnerH) : 0;
  const scroll = Math.min(detailScroll, maxScroll);

  const moveSelection = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const next = Math.max(0, Math.min(visible.length - 1, selectedIndex + delta));
      const issue = visible[next];
      if (!issue) return;
      lastIndexRef.current = next;
      if (issue.id !== selectedId) {
        setSelectedId(issue.id);
        setDetailScroll(0);
      }
    },
    [visible, selectedIndex, selectedId],
  );

  useInput(
    (input, key) => {
      // The confirmation modal captures ALL input while open.
      if (confirmCloseId) {
        if (input === 'y' || input === 'Y') {
          setConfirmCloseId(null);
          runClose(confirmCloseId);
        } else if (input === 'n' || input === 'N' || input === 'q' || key.escape) {
          setConfirmCloseId(null);
        }
        return;
      }
      if (input === 'q' || (key.ctrl && input === 'c')) {
        exit();
        return;
      }
      if (input === 'r') {
        void store.refresh();
        return;
      }
      if (input === 'a') {
        setShowClosed((v) => !v);
        return;
      }
      if (input === 'c' && selected) {
        if (selected.status === 'closed') showFlash(`${selected.id} is already closed`);
        else setConfirmCloseId(selected.id);
        return;
      }
      if (key.tab) {
        setFocus((f) => (f === 'list' ? 'detail' : 'list'));
        return;
      }
      if (focus === 'list') {
        if (key.upArrow || input === 'k') moveSelection(-1);
        else if (key.downArrow || input === 'j') moveSelection(1);
        else if (key.return && selected) {
          copyToClipboard(selected.id)
            .then(() => showFlash(`Copied ${selected.id} to clipboard`))
            .catch((e) => showFlash(`Copy failed: ${e instanceof Error ? e.message : e}`));
        }
      } else {
        if (key.downArrow || input === 'j') setDetailScroll(Math.min(maxScroll, scroll + 2));
        else if (key.upArrow || input === 'k') setDetailScroll(Math.max(0, scroll - 2));
      }
    },
    // isRawModeSupported is stdin.isTTY, which is undefined (not false) when
    // headless; useInput only skips raw mode on an exact `false`.
    { isActive: isRawModeSupported === true },
  );

  const listLabel = showClosed ? ' All Tasks ' : ' Active Tasks ';
  const detailLabel = selected ? ` ${shortId(selected.id)} ` : ' Description ';

  const detailBody: Array<{ text: string; bold?: boolean }> = [];
  if (!state.loadedOnce) {
    detailBody.push({ text: 'Loading…' });
  } else if (state.error) {
    detailBody.push({ text: `Error loading tasks: ${state.error}` });
  } else if (!selected || !detail) {
    detailBody.push({ text: 'No tasks match the current filters.' });
  } else {
    detail.lines.slice(scroll, scroll + detailInnerH).forEach((text, i) => {
      detailBody.push({ text, bold: scroll + i < detail.boldUntil });
    });
  }

  const workspaceInfo = `${workspace.name} · ${workspace.doltMode} · ${
    workspace.synced ? 'SYNCED' : 'LOCAL'
  } · live:${live} `;

  const listColor = focus === 'list' ? 'green' : 'blue';
  const detailColor = focus === 'detail' ? 'green' : 'blue';

  // Each pane stacks a hand-drawn top border row (Ink borders can't carry a
  // label) above a Box with the remaining three border sides.
  const panes = (
    <>
      <Box width={listW} height={listH} flexDirection="column">
        <Text color={listColor} wrap="truncate-end">
          {borderTopLine(listLabel, listW)}
        </Text>
        <Box
          width={listW}
          height={listH - 1}
          borderStyle="single"
          borderTop={false}
          borderColor={listColor}
          flexDirection="column"
          overflow="hidden"
        >
          {windowIssues.map((issue, i) => {
            const isSelected = winStart + i === selectedIndex;
            return (
              <Text
                key={issue.id}
                wrap="truncate-end"
                bold={isSelected}
                color={isSelected ? 'white' : undefined}
                backgroundColor={isSelected ? 'blue' : undefined}
              >
                {formatRow(issue, byId)}
              </Text>
            );
          })}
        </Box>
      </Box>
      <Box width={detailW} height={detailH} flexDirection="column">
        <Text color={detailColor} wrap="truncate-end">
          {borderTopLine(detailLabel, detailW)}
        </Text>
        <Box
          width={detailW}
          height={detailH - 1}
          borderStyle="single"
          borderTop={false}
          borderColor={detailColor}
          flexDirection="column"
          overflow="hidden"
        >
          {detailBody.map((line, i) => (
            <Text key={i} bold={line.bold} wrap="truncate-end">
              {line.text || ' '}
            </Text>
          ))}
        </Box>
      </Box>
    </>
  );

  // Close-confirmation modal: Ink has no overlay/z-index, so while open it
  // replaces the body (header/status bars stay). Auto-cancel above guarantees
  // the target is still the selected issue.
  const confirmTarget = confirmCloseId && selected?.id === confirmCloseId ? selected : null;
  const modalW = Math.max(30, Math.min(50, columns - 4));
  const modal = confirmTarget ? (
    <Box width={columns} height={bodyH} alignItems="center" justifyContent="center">
      <Box
        width={modalW}
        borderStyle="single"
        borderColor="yellow"
        flexDirection="column"
        paddingX={1}
      >
        {closeModalLines(confirmTarget, modalW - 4).map((text, i) => (
          <Text key={i} bold={i === 0} wrap="truncate-end">
            {text || ' '}
          </Text>
        ))}
      </Box>
    </Box>
  ) : null;

  return (
    <Box width={columns} height={rows} flexDirection="column">
      {modal ?? (landscape ? (
        <Box height={bodyH}>{panes}</Box>
      ) : (
        <Box height={bodyH} flexDirection="column">
          {panes}
        </Box>
      ))}
      <Text backgroundColor="gray" color="black" wrap="truncate-end">
        {fitBar(legendText(showClosed), workspaceInfo, columns)}
      </Text>
      <Text backgroundColor="white" color="black" wrap="truncate-end">
        {fitBar(flash ? ` ${flash}` : STATUS_HINTS, '', columns)}
      </Text>
    </Box>
  );
}
