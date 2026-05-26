// 외부 코딩 에이전트(Claude Code / Codex)의 로컬 세션 기록 조회.
// Tauri 환경에서만 동작 — 로컬 ~/.claude, ~/.codex 디렉토리 접근이 필요하기 때문.

import { invoke, isTauri } from '../runtime';

export type SessionSource = 'claude' | 'codex' | 'all';

export interface SessionMeta {
  source: 'claude' | 'codex';
  id: string;
  file: string;
  cwd: string | null;
  title: string;
  /** 최근 수정 epoch ms */
  modified_ms: number;
  size: number;
}

export interface SessionMsg {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string | null;
}

export async function listSessions(source: SessionSource): Promise<SessionMeta[]> {
  if (!isTauri) throw new Error('세션 기록은 Tauri 데스크톱 모드에서만 조회됩니다');
  return invoke<SessionMeta[]>('sessions_list', { source });
}

/** 강제 재인덱싱 — 새 세션 즉시 반영용 */
export async function refreshSessions(): Promise<number> {
  if (!isTauri) return 0;
  return invoke<number>('sessions_refresh');
}

export async function loadSession(
  source: 'claude' | 'codex',
  file: string,
): Promise<SessionMsg[]> {
  if (!isTauri) throw new Error('세션 기록은 Tauri 데스크톱 모드에서만 조회됩니다');
  return invoke<SessionMsg[]>('session_load', { source, file });
}
