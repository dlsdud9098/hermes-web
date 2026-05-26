// Claude/Codex 계정 풀 API — Tauri 전용.
// 백엔드(src-tauri/src/accounts.rs)가 라이브 credential 파일을 스냅샷/스왑.

import { invoke, isTauri } from '../runtime';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type Provider = 'claude' | 'codex';

export interface Account {
  id: string;
  label: string;
  provider: string;
  added_at_ms: number;
  last_used_at_ms: number;
}

export interface AccountWithStatus extends Account {
  is_active: boolean;
}

export interface AutoRotateConfig {
  enabled: boolean;
  threshold_pct: number;
}

export interface AccountRotatedEvent {
  provider: string;
  from_id: string;
  from_label: string;
  to_id: string;
  to_label: string;
  reason: string;
}

function ensureTauri(): void {
  if (!isTauri) {
    throw new Error('계정 풀 기능은 Tauri 데스크톱 모드에서만 동작합니다');
  }
}

export async function accountsList(provider: Provider): Promise<AccountWithStatus[]> {
  ensureTauri();
  return invoke<AccountWithStatus[]>('accounts_list', { provider });
}

export async function accountAddCurrent(provider: Provider, label: string): Promise<Account> {
  ensureTauri();
  return invoke<Account>('account_add_current', { provider, label });
}

export async function accountRemove(provider: Provider, id: string): Promise<void> {
  ensureTauri();
  return invoke<void>('account_remove', { provider, id });
}

export async function accountSetActive(provider: Provider, id: string): Promise<void> {
  ensureTauri();
  return invoke<void>('account_set_active', { provider, id });
}

export async function accountGetActive(provider: Provider): Promise<string | null> {
  ensureTauri();
  return invoke<string | null>('account_get_active', { provider });
}

export async function accountRename(provider: Provider, id: string, label: string): Promise<void> {
  ensureTauri();
  return invoke<void>('account_rename', { provider, id, label });
}

export async function accountAutoRotateGet(): Promise<AutoRotateConfig> {
  ensureTauri();
  return invoke<AutoRotateConfig>('account_auto_rotate_get');
}

export async function accountAutoRotateSet(config: AutoRotateConfig): Promise<void> {
  ensureTauri();
  return invoke<void>('account_auto_rotate_set', { config });
}

/** 자동 로테이션 이벤트 구독. UnlistenFn 으로 해제. */
export async function onAccountRotated(
  fn: (e: AccountRotatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<AccountRotatedEvent>('accounts:rotated', (ev) => fn(ev.payload));
}
