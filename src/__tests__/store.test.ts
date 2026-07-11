import { describe, expect, it } from 'bun:test';
import { createIssueStore } from '../store';
import type { Issue } from '../types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createIssueStore', () => {
  it('notifies only when the snapshot changes', async () => {
    let issues: Issue[] = [{ id: 'a', status: 'open', updated_at: '1' }];
    const store = createIssueStore(async () => issues);
    let notifications = 0;
    store.subscribe(() => notifications++);

    await store.refresh();
    expect(notifications).toBe(1);
    expect(store.getState().issues).toHaveLength(1);

    await store.refresh(); // no change
    expect(notifications).toBe(1);

    issues = [{ id: 'a', status: 'closed', updated_at: '2' }];
    await store.refresh();
    expect(notifications).toBe(2);
    expect(store.getState().issues[0]?.status).toBe('closed');
  });

  it('drops overlapping refreshes', async () => {
    let calls = 0;
    const store = createIssueStore(async () => {
      calls++;
      await sleep(30);
      return [];
    });
    const first = store.refresh();
    await store.refresh(); // dropped: first still in flight
    await first;
    expect(calls).toBe(1);
  });

  it('surfaces fetch errors without losing existing issues', async () => {
    let fail = false;
    const store = createIssueStore(async () => {
      if (fail) throw new Error('bd exploded');
      return [{ id: 'a', status: 'open' } as Issue];
    });
    await store.refresh();
    fail = true;
    await store.refresh();
    expect(store.getState().error).toContain('bd exploded');
    expect(store.getState().issues).toHaveLength(1);
    fail = false;
    await store.refresh();
    expect(store.getState().error).toBeNull();
  });
});
