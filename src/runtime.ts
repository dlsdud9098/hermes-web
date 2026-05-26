// 실행 환경 감지 + Tauri/브라우저 공통 인터페이스.
//  - Tauri: invoke / plugin-http fetch (CORS 우회 + Origin 자유)
//  - 브라우저: vite dev 미들웨어 + 프록시 (/fs/*, /api/*)

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/** Tauri 웹뷰 내부에서 실행 중인가 (window.__TAURI_INTERNALS__ 존재 여부) */
export const isTauri: boolean =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

/** Rust 커맨드 호출 — 브라우저에선 호출 금지(엔드포인트 fetch 로 분기) */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

/**
 * HTTP fetch — Tauri 환경이면 plugin-http(=Rust 경유, CORS/Origin 무관) 사용.
 * 그 외엔 브라우저 fetch. 시그니처는 표준 fetch 와 동일.
 */
export const httpFetch: typeof fetch = isTauri
  ? (tauriFetch as unknown as typeof fetch)
  : ((input, init) => fetch(input, init));
