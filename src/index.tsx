#!/usr/bin/env bun
import { render } from 'ink';
import { fetchIssues } from './bd';
import { connectDoltServer, startDetector } from './detector';
import { createIssueStore } from './store';
import { App } from './tui/App';
import { discoverWorkspace, readDoltServerPort } from './workspace';

const workspace = discoverWorkspace(process.cwd());
if (!workspace) {
  console.error('No .beads directory found. Run from a beads-enabled project.');
  process.exit(1);
}
const ws = workspace;

const store = createIssueStore(() => fetchIssues(ws.root));

const database = ws.doltDatabase;
const connect =
  ws.doltMode === 'server' && database
    ? () => connectDoltServer(readDoltServerPort(), database)
    : undefined;

// Full-screen: switch to the alternate screen buffer and restore on exit.
const useAltScreen = process.stdout.isTTY;
if (useAltScreen) process.stdout.write('\x1b[?1049h\x1b[H');
const restoreScreen = () => {
  if (useAltScreen) process.stdout.write('\x1b[?1049l');
};

const app = render(
  <App
    workspace={ws}
    store={store}
    createDetector={(onTrigger, onStatus) =>
      startDetector({ mode: ws.doltMode, onTrigger, onStatus, connect })
    }
  />,
  { exitOnCtrlC: true },
);

app
  .waitUntilExit()
  .then(() => {
    restoreScreen();
    process.exit(0);
  })
  .catch(() => {
    restoreScreen();
    process.exit(1);
  });
