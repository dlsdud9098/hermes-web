// Claude Code 인터랙티브 PTY 백엔드 — Tauri 전용.
// JSONL incremental tail 로 블록 단위 스트리밍.

import { invoke, isTauri } from '../runtime';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface DeltaEvent { panel_id: string; text: string }
export interface ToolStartEvent { panel_id: string; tool: string; preview: string; id: string }
export interface ToolEndEvent { panel_id: string; id: string; error: boolean }
export interface TurnEndEvent { panel_id: string }

export interface ClaudeStatus {
  installed: boolean;
  logged_in: boolean;
  version: string;
  login_method: string;
}

export async function claudeStart(panelId: string, cwd: string): Promise<string> {
  if (!isTauri) throw new Error('Claude Code 백엔드는 Tauri 데스크톱 모드에서만 동작합니다');
  return invoke<string>('claude_start', { panelId, cwd });
}

export async function claudeSend(panelId: string, text: string): Promise<void> {
  if (!isTauri) throw new Error('Claude Code 백엔드는 Tauri 데스크톱 모드에서만 동작합니다');
  return invoke<void>('claude_send', { panelId, text });
}

export async function claudeStop(panelId: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('claude_stop', { panelId });
}

export async function claudeStopAll(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('claude_stop_all');
}

export interface ClaudeRateLimit {
  status: string;            // "allowed" | "exceeded" 등
  resets_at: number;         // unix epoch (초)
  rate_limit_type: string;   // "five_hour" 등
  is_using_overage: boolean;
  checked_at_ms: number;
}

/** Max 구독 quota 조회 — 5h 윈도우 안에선 캐시. force=true 로 즉시 재조회 */
export async function claudeRateLimit(force = false): Promise<ClaudeRateLimit | null> {
  if (!isTauri) return null;
  try {
    return await invoke<ClaudeRateLimit | null>('claude_rate_limit', { force });
  } catch {
    return null;
  }
}

export async function claudeCheck(): Promise<ClaudeStatus> {
  if (!isTauri) {
    return { installed: false, logged_in: false, version: '', login_method: '' };
  }
  return invoke<ClaudeStatus>('claude_check');
}

export async function onClaudeDelta(fn: (e: DeltaEvent) => void): Promise<UnlistenFn> {
  return listen<DeltaEvent>('claude:delta', (ev) => fn(ev.payload));
}
export async function onClaudeToolStart(fn: (e: ToolStartEvent) => void): Promise<UnlistenFn> {
  return listen<ToolStartEvent>('claude:tool-start', (ev) => fn(ev.payload));
}
export async function onClaudeToolEnd(fn: (e: ToolEndEvent) => void): Promise<UnlistenFn> {
  return listen<ToolEndEvent>('claude:tool-end', (ev) => fn(ev.payload));
}
export async function onClaudeTurnEnd(fn: (e: TurnEndEvent) => void): Promise<UnlistenFn> {
  return listen<TurnEndEvent>('claude:turn-end', (ev) => fn(ev.payload));
}
