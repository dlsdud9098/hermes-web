// 구독 사용량 조회 — Claude OAuth API + Codex 비공개 엔드포인트.

import { invoke, isTauri } from '../runtime';

export interface ClaudeWindow {
  utilization_pct: number;     // 0~100
  resets_at: string;
  seconds_until_reset: number;
}

export interface ClaudeUsage {
  five_hour: ClaudeWindow | null;
  seven_day: ClaudeWindow | null;
  seven_day_sonnet: ClaudeWindow | null;
  seven_day_opus: ClaudeWindow | null;
  extra_usage_pct: number | null;
  fetched_at_ms: number;
}

export interface CodexWindow {
  used_pct: number;            // 0~100
  window_seconds: number;
  seconds_until_reset: number;
}

export interface CodexUsage {
  plan_type: string;
  primary: CodexWindow | null;
  secondary: CodexWindow | null;
  has_credits: boolean;
  credits_balance: number;
  fetched_at_ms: number;
}

export async function claudeUsage(force = false): Promise<ClaudeUsage | null> {
  if (!isTauri) return null;
  try { return await invoke<ClaudeUsage | null>('claude_usage', { force }); }
  catch { return null; }
}

export async function codexUsage(force = false): Promise<CodexUsage | null> {
  if (!isTauri) return null;
  try { return await invoke<CodexUsage | null>('codex_usage', { force }); }
  catch { return null; }
}

/** 초 → "2h 30m" / "12m" / "리셋됨" 형식 */
export function fmtRemaining(seconds: number): string {
  if (seconds <= 0) return '리셋됨';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
