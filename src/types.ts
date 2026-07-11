/** A dependency edge as emitted by `bd list --json` (bd v1.1.0). */
export interface Dependency {
  issue_id: string;
  depends_on_id: string;
  /** e.g. "blocks", "parent-child", "related", "discovered-from" */
  type: string;
}

/** An issue as emitted by `bd list --all -n 0 --json`. Only fields the UI consumes. */
export interface Issue {
  id: string;
  title?: string;
  description?: string;
  status: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  labels?: string[];
  created_at?: string;
  updated_at?: string;
  dependencies?: Dependency[];
  dependency_count?: number;
  /** Computed by bd from the parent-child dependency. */
  parent?: string;
}

export type Bucket = 'open' | 'in_progress' | 'blocked' | 'closed';

export type LiveStatus = 'sql' | 'poll' | 'manual';
