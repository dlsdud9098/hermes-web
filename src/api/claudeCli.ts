// Claude Code 인터랙티브 PTY 백엔드 — Tauri 전용.
// claude -p 를 쓰지 않고 진짜 TUI 를 PTY 안에서 spawn → Stop 훅으로 턴 경계 감지 →
// Claude 가 보관하는 표준 JSONL 을 단일 진실원천으로 파싱.

import { invoke, isTauri } from '../runtime';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ClaudeTurnEvent {
  panel_id: string;
  text: string;
  tools: string[];
}

/** 새 세션 시작 — 반환값은 session id (UUID) */
export async function claudeStart(panelId: string, cwd: string): Promise<string> {
  if (!isTauri) throw new Error('Claude Code 백엔드는 Tauri 데스크톱 모드에서만 동작합니다');
  return invoke<string>('claude_start', { panelId, cwd });
}

/** PTY 에 프롬프트 + 엔터 전송 */
export async function claudeSend(panelId: string, text: string): Promise<void> {
  if (!isTauri) throw new Error('Claude Code 백엔드는 Tauri 데스크톱 모드에서만 동작합니다');
  return invoke<void>('claude_send', { panelId, text });
}

/** 세션 종료 — PTY kill + 임시파일 정리 */
export async function claudeStop(panelId: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('claude_stop', { panelId });
}

/** claude 명령이 PATH 에 있고 실행 가능한지 */
export async function claudeCheck(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return await invoke<boolean>('claude_check');
  } catch {
    return false;
  }
}

/** 턴 완료 이벤트 구독 */
export async function onClaudeTurn(
  fn: (ev: ClaudeTurnEvent) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeTurnEvent>('claude:turn', (event) => fn(event.payload));
}
