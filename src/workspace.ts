import fs from 'node:fs';
import path from 'node:path';

export interface Workspace {
  /** Directory containing .beads — cwd for all bd invocations. */
  root: string;
  beadsDir: string;
  /** Display name: basename of the root directory. */
  name: string;
  doltMode: 'server' | 'embedded';
  doltDatabase: string | null;
  /** True when .beads/config.yaml sets sync.remote (issues sync somewhere). */
  synced: boolean;
}

/** Walk up from startDir to the filesystem root looking for a `.beads` directory. */
export function findBeadsDir(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, '.beads');
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Discover the workspace at/above startDir. Returns null when no .beads
 * exists. A missing or unreadable metadata.json is NOT fatal: we degrade to
 * embedded-style polling (dolt mode/database only drive live updates).
 */
export function discoverWorkspace(startDir: string): Workspace | null {
  const beadsDir = findBeadsDir(startDir);
  if (!beadsDir) return null;
  const root = path.dirname(beadsDir);

  let doltMode: 'server' | 'embedded' = 'embedded';
  let doltDatabase: string | null = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(beadsDir, 'metadata.json'), 'utf8'));
    if (meta.dolt_mode === 'server') doltMode = 'server';
    if (typeof meta.dolt_database === 'string') doltDatabase = meta.dolt_database;
  } catch {
    // degrade to embedded-style polling
  }

  return {
    root,
    beadsDir,
    name: path.basename(root),
    doltMode,
    doltDatabase,
    synced: readSynced(beadsDir),
  };
}

/** True when config.yaml has an active (non-comment) sync.remote with a value. */
function readSynced(beadsDir: string): boolean {
  try {
    const yaml = fs.readFileSync(path.join(beadsDir, 'config.yaml'), 'utf8');
    if (/^\s*sync\.remote:\s*\S/m.test(yaml)) return true;
    // nested form:  sync:\n  remote: <url>
    return /^sync:\s*$[\s\S]*?^\s+remote:\s*\S/m.test(yaml);
  } catch {
    return false;
  }
}

/** Read the shared dolt server's port file; fall back to 3308. */
export function readDoltServerPort(
  portFile = path.join(process.env.HOME ?? '', '.beads', 'shared-server', 'dolt-server.port'),
): number {
  try {
    const n = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through
  }
  return 3308;
}
