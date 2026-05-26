// 인앱 임베드 브라우저 (Tauri 자식 webview) 제어.
// 같은 커맨드를 에이전트도 호출 가능 — MCP 거치지 않고 직접.

import { invoke, isTauri } from '../runtime';

interface Bounds { x: number; y: number; w: number; h: number }

export async function browserCreate(panelId: string, url: string, b: Bounds): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('browser_create', { panelId, url, ...b });
}
export async function browserNavigate(panelId: string, url: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('browser_navigate', { panelId, url });
}
export async function browserSetBounds(panelId: string, b: Bounds): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('browser_set_bounds', { panelId, ...b });
}
export async function browserSetVisible(panelId: string, visible: boolean): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('browser_set_visible', { panelId, visible });
}
export async function browserClose(panelId: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('browser_close', { panelId });
}
/** 임베드 브라우저 안에서 JS 실행 — 에이전트의 click/fill/scroll 채널 */
export async function browserEval(panelId: string, code: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>('browser_eval', { panelId, code });
}
