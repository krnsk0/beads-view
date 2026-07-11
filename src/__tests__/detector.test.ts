import { describe, expect, it } from 'bun:test';
import { startDetector, type HashConnection } from '../detector';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('startDetector (server mode)', () => {
  it('triggers on dolt hash change, debounced', async () => {
    let hash = 'aaa';
    let triggers = 0;
    const statuses: string[] = [];
    const conn: HashConnection = {
      hash: async () => hash,
      destroy() {},
    };
    const detector = startDetector({
      mode: 'server',
      connect: async () => conn,
      onTrigger: () => triggers++,
      onStatus: (s) => statuses.push(s),
      hashIntervalMs: 10,
      debounceMs: 5,
    });
    await sleep(50);
    expect(triggers).toBe(0); // stable hash, no triggers
    hash = 'bbb';
    await sleep(60);
    expect(triggers).toBe(1); // one debounced trigger for the change
    expect(statuses).toContain('sql');
    detector.stop();
  });

  it('falls back to polling when the connection fails, then recovers', async () => {
    let triggers = 0;
    let attempts = 0;
    const statuses: string[] = [];
    const detector = startDetector({
      mode: 'server',
      connect: async () => {
        attempts++;
        if (attempts < 2) throw new Error('server down');
        return { hash: async () => 'zzz', destroy() {} };
      },
      onTrigger: () => triggers++,
      onStatus: (s) => statuses.push(s),
      hashIntervalMs: 10,
      pollIntervalMs: 15,
      debounceMs: 5,
      initialBackoffMs: 20,
      maxBackoffMs: 50,
    });
    await sleep(60);
    expect(statuses[0]).toBe('poll'); // degraded first
    expect(triggers).toBeGreaterThan(0); // poll fallback fired refreshes
    expect(statuses).toContain('sql'); // then reconnected
    detector.stop();
    const settled = triggers;
    await sleep(50);
    expect(triggers).toBe(settled); // stop() halts everything
  });
});

describe('startDetector (embedded mode)', () => {
  it('triggers on an interval and stops cleanly', async () => {
    let triggers = 0;
    const detector = startDetector({
      mode: 'embedded',
      onTrigger: () => triggers++,
      pollIntervalMs: 10,
    });
    await sleep(45);
    detector.stop();
    expect(triggers).toBeGreaterThanOrEqual(2);
    const settled = triggers;
    await sleep(30);
    expect(triggers).toBe(settled);
  });
});
