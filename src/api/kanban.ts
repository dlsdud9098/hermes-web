// Hermes kanban 백엔드 호출 — ~/.hermes/kanban.db 직접 SQLite.

import { invoke, isTauri } from '../runtime';

export type KanbanStatus =
  | 'triage' | 'todo' | 'scheduled' | 'ready'
  | 'running' | 'blocked' | 'review' | 'done' | 'archived';

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  status: KanbanStatus;
  assignee: string | null;
  priority: number;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  workspace_kind: string;
  workspace_path: string | null;
  session_id: string | null;
  last_failure_error: string | null;
  consecutive_failures: number;
  result: string | null;
  last_heartbeat_at: number | null;
  branch_name: string | null;
}

export interface CreateInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  session_id?: string;
}

function guard() {
  if (!isTauri) throw new Error('Kanban 은 Tauri 데스크톱 모드에서만 사용 가능');
}

export async function listKanban(includeArchived = false): Promise<KanbanTask[]> {
  guard();
  return invoke<KanbanTask[]>('kanban_list', { includeArchived });
}

export async function createKanban(input: CreateInput): Promise<KanbanTask> {
  guard();
  return invoke<KanbanTask>('kanban_create', { input });
}

export async function moveKanban(id: string, status: KanbanStatus): Promise<void> {
  guard();
  await invoke<void>('kanban_move', { id, status });
}

export async function deleteKanban(id: string): Promise<void> {
  guard();
  await invoke<void>('kanban_delete', { id });
}

export interface TaskEvent {
  id: number;
  run_id: number | null;
  kind: string;
  payload: string | null;
  created_at: number;
}

export interface TaskRun {
  id: number;
  profile: string | null;
  step_key: string | null;
  status: string;
  worker_pid: number | null;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
}

export interface TaskComment {
  id: number;
  author: string;
  body: string;
  created_at: number;
}

export interface KanbanDetail {
  events: TaskEvent[];
  runs: TaskRun[];
  comments: TaskComment[];
}

export async function detailKanban(id: string): Promise<KanbanDetail> {
  guard();
  return invoke<KanbanDetail>('kanban_detail', { id });
}

export async function commentKanban(id: string, body: string): Promise<void> {
  guard();
  await invoke<void>('kanban_comment', { id, body });
}

export async function editKanban(
  id: string,
  patch: { title?: string; body?: string; priority?: number; assignee?: string },
): Promise<void> {
  guard();
  await invoke<void>('kanban_edit', { id, ...patch });
}

export interface KanbanDiff {
  workspace_path: string | null;
  branch_name: string | null;
  diff: string | null;
  note: string | null;
}

export async function diffKanban(id: string): Promise<KanbanDiff> {
  guard();
  return invoke<KanbanDiff>('kanban_diff', { id });
}

export async function cleanupKanban(id: string): Promise<string> {
  guard();
  return invoke<string>('kanban_cleanup', { id });
}
