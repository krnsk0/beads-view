// One-off visual check: renders the real App against a real workspace at a
// fixed size and prints the final frame. Usage: bun scripts/eyeball.tsx <dir> <cols> <rows>
import { render } from 'ink-testing-library';
import { fetchIssues } from '../src/bd';
import { createIssueStore } from '../src/store';
import { App } from '../src/tui/App';
import { discoverWorkspace } from '../src/workspace';

const ws = discoverWorkspace(process.argv[2] ?? process.cwd());
if (!ws) throw new Error('no .beads');
const store = createIssueStore(() => fetchIssues(ws.root));
await store.refresh();
const r = render(
  <App
    workspace={ws}
    store={store}
    createDetector={() => ({ stop() {} })}
    initialDims={{ columns: Number(process.argv[3] ?? 120), rows: Number(process.argv[4] ?? 30) }}
  />,
);
await new Promise((res) => setTimeout(res, 50));
console.log(r.lastFrame());
r.unmount();
