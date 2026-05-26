// Codex CLI 백엔드 — codex exec --json 비대화 모드.
// ChatGPT Plus/Pro 구독 OAuth (사전 `codex login`).

import { invoke, isTauri } from '../runtime';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface CodexDelta { panel_id: string; text: string }
export interface CodexToolStart { panel_id: string; tool: string; preview: string; id: string }
export interface CodexToolEnd { panel_id: string; id: string; error: boolean }
export interface CodexTurnEnd { panel_id: string; input_tokens: number; output_tokens: number }
export interface CodexErrorEvent { panel_id: string; message: string }

export async function codexSend(panelId: string, cwd: string, text: string): Promise<void> {
  if (!isTauri) throw new Error('Codex 는 Tauri 데스크톱 모드에서만 동작');
  return invoke<void>('codex_send', { panelId, cwd, text });
}

export async function codexClearSession(panelId: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('codex_clear_session', { panelId });
}

export async function codexCheck(): Promise<boolean> {
  if (!isTauri) return false;
  try { return await invoke<boolean>('codex_check'); } catch { return false; }
}

export async function codexLoginStatus(): Promise<string> {
  if (!isTauri) return '';
  try { return await invoke<string>('codex_login_status'); } catch { return ''; }
}

export async function onCodexDelta(fn: (e: CodexDelta) => void): Promise<UnlistenFn> {
  return listen<CodexDelta>('codex:delta', (ev) => fn(ev.payload));
}
export async function onCodexToolStart(fn: (e: CodexToolStart) => void): Promise<UnlistenFn> {
  return listen<CodexToolStart>('codex:tool-start', (ev) => fn(ev.payload));
}
export async function onCodexToolEnd(fn: (e: CodexToolEnd) => void): Promise<UnlistenFn> {
  return listen<CodexToolEnd>('codex:tool-end', (ev) => fn(ev.payload));
}
export async function onCodexTurnEnd(fn: (e: CodexTurnEnd) => void): Promise<UnlistenFn> {
  return listen<CodexTurnEnd>('codex:turn-end', (ev) => fn(ev.payload));
}
export async function onCodexError(fn: (e: CodexErrorEvent) => void): Promise<UnlistenFn> {
  return listen<CodexErrorEvent>('codex:error', (ev) => fn(ev.payload));
}
