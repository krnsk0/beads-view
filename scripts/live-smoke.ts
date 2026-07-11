// Headless smoke test of the data + change-detection layers against a real
// workspace. Prints a timestamped line every time the issue set changes.
// Usage: bun scripts/live-smoke.ts <workspace-dir> [seconds]
import { fetchIssues } from '../src/bd';
import { connectDoltServer, startDetector } from '../src/detector';
import { createIssueStore } from '../src/store';
import { discoverWorkspace, readDoltServerPort } from '../src/workspace';

const dir = process.argv[2] ?? process.cwd();
const seconds = Number(process.argv[3] ?? 30);
const ws = discoverWorkspace(dir);
if (!ws) {
  console.error('no .beads found');
  process.exit(1);
}
console.log(`[${new Date().toISOString()}] workspace=${ws.name} mode=${ws.doltMode} db=${ws.doltDatabase}`);

const store = createIssueStore(() => fetchIssues(ws.root));
store.subscribe(() => {
  const s = store.getState();
  const ids = s.issues.map((i) => `${i.id}:${i.status}`).join(' ');
  console.log(`[${new Date().toISOString()}] CHANGE n=${s.issues.length} ${s.error ? `error=${s.error}` : ids}`);
});

const database = ws.doltDatabase;
const connect =
  ws.doltMode === 'server' && database
    ? () => connectDoltServer(readDoltServerPort(), database)
    : undefined;
const detector = startDetector({
  mode: ws.doltMode,
  connect,
  onTrigger: () => void store.refresh(),
  onStatus: (s) => console.log(`[${new Date().toISOString()}] live=${s}`),
});
void store.refresh();

setTimeout(() => {
  detector.stop();
  console.log('done');
  process.exit(0);
}, seconds * 1000);
