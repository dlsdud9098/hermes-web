// Hermes Agent API 클라이언트 — OpenAI 호환 /chat/completions SSE 스트리밍.
//
// 2단 메모리: 프로젝트 ID 를 마지막 user 메시지 끝에 마커로 부착한다.
// Hermes 훅(pre_llm_call)이 받는 채널 중 프론트가 통제 가능한 것은 user 메시지 본문뿐 —
// system 메시지는 Hermes 가 자체 system prompt 로 흡수해 conversation_history 에서 사라지고,
// model 필드도 내부 모델명으로 정규화된다. 그래서 user 메시지에 마커를 싣는다.
// hermes-web-memory 플러그인이 이 마커를 읽어 프로젝트별 MEMORY.md 를 주입한다.
// 전역 메모리(MEMORY.md / USER.md)는 Hermes 가 system prompt 에 자동 주입.

import type { ChatMessage } from '../types';

/** 플러그인(hermes-plugin/hermes-web-memory)과 반드시 동일해야 하는 마커 */
export const PROJECT_MARKER = 'hermes-web:project=';

// 기본값은 vite dev 프록시 경로(/api → Hermes). CORS 없이 동작.
// 프록시 없이 직접 붙으려면 VITE_HERMES_BASE 로 절대 URL 지정.
const DEFAULT_BASE = (import.meta.env.VITE_HERMES_BASE as string | undefined)
  ?? '/api/v1';

// Hermes API_SERVER_KEY (Bearer 토큰). 빌드 시 주입.
const DEFAULT_KEY = import.meta.env.VITE_HERMES_KEY as string | undefined;

export class HermesApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Hermes API ${status}: ${message}`);
    this.name = 'HermesApiError';
    this.status = status;
  }
}

export interface StreamChatOptions {
  projectId: string;
  messages: ChatMessage[];
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/** 토큰 델타를 순차 yield 하는 async generator */
export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<string> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const key = opts.apiKey ?? DEFAULT_KEY;

  // 프로젝트 마커를 마지막 user 메시지 끝에 부착 → 플러그인이 user_message 에서 읽음
  const lastUserIdx = opts.messages.map((m) => m.role).lastIndexOf('user');
  const messages: ChatMessage[] = opts.messages.map((m, i) =>
    i === lastUserIdx
      ? { ...m, content: `${m.content}\n\n${PROJECT_MARKER}${opts.projectId}` }
      : m,
  );

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model ?? 'hermes',
      stream: true,
      messages,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new HermesApiError(res.status, detail.slice(0, 300));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const delta: string | undefined = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // keepalive / 부분 청크 — 무시
      }
    }
  }
}
