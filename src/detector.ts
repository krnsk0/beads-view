import type { LiveStatus } from './types';

/** Minimal slice of a mysql2 connection the detector needs (injectable for tests). */
export interface HashConnection {
  hash(): Promise<string>;
  destroy(): void;
}

export interface DetectorOptions {
  mode: 'server' | 'embedded';
  /** Called when a refresh should happen. */
  onTrigger: () => void;
  /** Called when the live-update channel changes (sql vs poll). */
  onStatus?: (status: LiveStatus) => void;
  /** Server mode: opens a MySQL connection to the shared dolt server. */
  connect?: () => Promise<HashConnection>;
  hashIntervalMs?: number; // default 500
  pollIntervalMs?: number; // default 2000
  debounceMs?: number; // default 100
  initialBackoffMs?: number; // default 1000
  maxBackoffMs?: number; // default 30000
}

export interface Detector {
  stop(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Real connection factory: mysql2 to 127.0.0.1:<port>, root, empty password, no TLS. */
export async function connectDoltServer(port: number, database: string): Promise<HashConnection> {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port,
    user: 'root',
    password: '',
    database,
    connectTimeout: 3000,
  });
  return {
    async hash() {
      const [rows] = await conn.query('SELECT dolt_hashof_db() AS h');
      const row = (rows as Array<{ h: string }>)[0];
      if (!row) throw new Error('empty dolt_hashof_db() result');
      return row.h;
    },
    destroy() {
      conn.destroy();
    },
  };
}

/**
 * Watches the beads database for external changes and fires onTrigger.
 *
 * Server mode: polls `SELECT dolt_hashof_db()` over a persistent MySQL
 * connection every hashIntervalMs; a hash change triggers (debounced) a
 * refresh. Connection failures switch to embedded-style polling while the
 * connection is retried with exponential backoff — the UI never crashes over
 * a dropped connection.
 *
 * Embedded mode (or missing metadata): plain interval that triggers a
 * refresh every pollIntervalMs; the store's snapshot diff makes no-op polls
 * free for the UI. Polling only — no file watchers, so our own bd reads
 * touching dolt files can't self-trigger a loop.
 */
export function startDetector(opts: DetectorOptions): Detector {
  const hashIntervalMs = opts.hashIntervalMs ?? 500;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const debounceMs = opts.debounceMs ?? 100;
  const initialBackoffMs = opts.initialBackoffMs ?? 1000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;

  let stopped = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeConn: HashConnection | null = null;

  function trigger() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!stopped) opts.onTrigger();
    }, debounceMs);
  }

  function startPolling() {
    if (pollTimer) return;
    opts.onStatus?.('poll');
    pollTimer = setInterval(() => {
      if (!stopped) opts.onTrigger();
    }, pollIntervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function serverLoop(connect: () => Promise<HashConnection>) {
    let backoff = initialBackoffMs;
    while (!stopped) {
      let conn: HashConnection | null = null;
      try {
        conn = await connect();
        activeConn = conn;
        stopPolling();
        opts.onStatus?.('sql');
        backoff = initialBackoffMs;
        let lastHash: string | null = null;
        while (!stopped) {
          const h = await conn.hash();
          if (lastHash !== null && h !== lastHash) trigger();
          lastHash = h;
          await sleep(hashIntervalMs);
        }
      } catch {
        // fall through to retry
      } finally {
        activeConn = null;
        try {
          conn?.destroy();
        } catch {
          // ignore
        }
      }
      if (stopped) break;
      startPolling(); // degrade to embedded-style polling while the server is unreachable
      await sleep(backoff);
      backoff = Math.min(backoff * 2, maxBackoffMs);
    }
  }

  if (opts.mode === 'server' && opts.connect) {
    void serverLoop(opts.connect);
  } else {
    startPolling();
  }

  return {
    stop() {
      stopped = true;
      stopPolling();
      if (debounceTimer) clearTimeout(debounceTimer);
      try {
        activeConn?.destroy();
      } catch {
        // ignore
      }
    },
  };
}
