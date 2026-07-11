import { execFile } from 'node:child_process';
import type { Issue } from './types';

/**
 * Parse `bd list --json` output. Accepts a bare JSON array, the v2 envelope
 * `{"schema_version":1,"data":[...]}`, and the legacy `{"issues":[...]}`.
 */
export function parseBdList(stdout: string): Issue[] {
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && Array.isArray(parsed.issues)) return parsed.issues;
  throw new Error('unrecognized bd list --json shape');
}

/**
 * Close an issue via the bd CLI, cwd'd at the workspace root. Rejects with
 * bd's stderr (falling back to the exec error) so the UI can flash it.
 */
export function closeIssue(root: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('bd', ['close', id], { cwd: root, encoding: 'utf8' }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve();
    });
  });
}

/** Fetch the full issue set via the bd CLI, cwd'd at the workspace root. */
export function fetchIssues(root: string): Promise<Issue[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'bd',
      ['list', '--all', '-n', '0', '--json'],
      { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          resolve(parseBdList(stdout));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}
