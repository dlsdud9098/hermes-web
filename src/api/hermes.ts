// Hermes Agent API 클라이언트 — OpenAI 호환 /chat/completions SSE 스트리밍.
//
// 네이티브 세션: 요청마다 X-Hermes-Session-Id 헤더(= 패널 id)를 보낸다. Hermes 가
// 그 세션의 대화 히스토리를 서버측에 유지하므로, 클라이언트는 매번 새 user 메시지
// 하나만 전송한다(델타 전송). 전체 배열을 다시 보내지 않는다.
//
// 2단 메모리: 프로젝트 ID 를 user 메시지 끝에 마커로 부착한다.
// Hermes 훅(pre_llm_call)이 받는 채널 중 프론트가 통제 가능한 것은 user 메시지 본문뿐 —
// system 메시지는 Hermes 가 자체 system prompt 로 흡수해 conversation_history 에서 사라지고,
// model 필드도 내부 모델명으로 정규화된다. 그래서 user 메시지에 마커를 싣는다.
// hermes-web-memory 플러그인이 이 마커를 읽어 프로젝트별 MEMORY.md 를 주입한다.
// 전역 메모리(MEMORY.md / USER.md)는 Hermes 가 system prompt 에 자동 주입.

/** 플러그인(hermes-plugin/hermes-web-memory)과 반드시 동일해야 하는 마커 */
export const PROJECT_MARKER = 'hermes-web:project=';
/** 프로젝트 작업 폴더 마커 — 플러그인이 읽어 "이 폴더에서 작업하라"고 주입 */
export const CWD_MARKER = 'hermes-web:cwd=';

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
  /** 세션 연속성 키 — 패널 id 를 그대로 쓴다. Hermes 가 이 세션의 히스토리를 유지 */
  sessionId: string;
  /** 2단 메모리용 프로젝트 id */
  projectId: string;
  /** 프로젝트 작업 폴더 절대경로. 비어 있으면 cwd 마커 생략 */
  projectPath?: string;
  /** 이번 턴의 새 user 메시지 (히스토리 제외) */
  message: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/** 토큰 델타를 순차 yield 하는 async generator */
export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<string> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const key = opts.apiKey ?? DEFAULT_KEY;

  // 새 user 메시지 끝에 마커 부착 → 플러그인이 user_message 에서 읽음
  let content = `${opts.message}\n\n${PROJECT_MARKER}${opts.projectId}`;
  if (opts.projectPath && opts.projectPath.trim()) {
    content += `\n${CWD_MARKER}${opts.projectPath.trim()}`;
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hermes-Session-Id': opts.sessionId,
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model ?? 'hermes-agent',
      stream: true,
      messages: [{ role: 'user', content }],
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
