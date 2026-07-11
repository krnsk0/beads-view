import { snapshotOf } from './logic';
import type { Issue } from './types';

export interface StoreState {
  issues: Issue[];
  loadedOnce: boolean;
  error: string | null;
}

export interface IssueStore {
  getState(): StoreState;
  subscribe(listener: () => void): () => void;
  /** Reload from bd. Drops the call if a load is already in flight. */
  refresh(): Promise<void>;
}

/**
 * Holds the issue set and reloads it on demand. Listeners are only notified
 * when the data actually changed (snapshot diff of id:status:updated_at), so
 * no-op polls don't cause re-renders. Overlapping refreshes are dropped, not
 * queued. Fetch errors never throw out of refresh(); they land in state.error
 * and the previous issue set stays on screen.
 */
export function createIssueStore(fetchIssues: () => Promise<Issue[]>): IssueStore {
  let state: StoreState = { issues: [], loadedOnce: false, error: null };
  let snapshot: string | null = null;
  let loading = false;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      if (loading) return;
      loading = true;
      try {
        const issues = await fetchIssues();
        const snap = snapshotOf(issues);
        const changed = snap !== snapshot || !state.loadedOnce || state.error !== null;
        snapshot = snap;
        if (changed) {
          state = { issues, loadedOnce: true, error: null };
          emit();
        }
      } catch (e) {
        state = { ...state, loadedOnce: true, error: e instanceof Error ? e.message : String(e) };
        emit();
      } finally {
        loading = false;
      }
    },
  };
}
