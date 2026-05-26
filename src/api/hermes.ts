// Hermes Agent API 클라이언트 — /v1/runs 기반 에이전트 런 + SSE 이벤트 스트림.
//
// /v1/chat/completions 는 텍스트 델타만 준다. 에이전트의 툴 호출을 보려면 /v1/runs 를
// 써야 한다 — POST 로 런을 만들고 GET /events SSE 로 tool.*/message.delta/run.* 이벤트를 받는다.
//
// 네이티브 세션: X-Hermes-Session-Id 헤더(= 패널 id)로 서버측 히스토리를 유지하므로
// 매 턴 새 메시지 하나만 보낸다.
//
// 2단 메모리 / 작업 폴더: 메시지 끝에 마커를 부착한다 (플러그인 pre_llm_call 이 읽음).

/** 플러그인(hermes-plugin/hermes-web-memory)과 반드시 동일해야 하는 마커 */
export const PROJECT_MARKER = 'hermes-web:project=';
/** 프로젝트 작업 폴더 마커 */
export const CWD_MARKER = 'hermes-web:cwd=';

import { httpFetch, isTauri } from '../runtime';

// 로컬 전용 — 연결 정보는 .env 빌드타임 값으로 고정.
// Tauri: vite 프록시가 없으므로 게이트웨이 직접 호출 (plugin-http 로 CORS/Origin 우회).
// 브라우저: vite proxy 의 /api 경유.
const ENV_BASE = import.meta.env.VITE_HERMES_BASE as string | undefined;
const DEFAULT_BASE = ENV_BASE
  ?? (isTauri ? 'http://localhost:8642/v1' : '/api/v1');
const DEFAULT_KEY = import.meta.env.VITE_HERMES_KEY as string | undefined;

export class HermesApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Hermes API ${status}: ${message}`);
    this.name = 'HermesApiError';
    this.status = status;
  }
}

/** ChatPanel 이 소비하는 런 이벤트 (정규화된 형태) */
export type RunEvent =
  | { type: 'tool-start'; tool: string; preview: string }
  | { type: 'tool-end'; tool: string; duration: number; error: boolean }
  | { type: 'text'; delta: string }
  | { type: 'approval'; runId: string; command: string; description: string; choices: string[] }
  | { type: 'approval-resolved' }
  | { type: 'done'; output: string; usage?: { input: number; output: number } }
  | { type: 'error'; message: string };

export interface StreamRunOptions {
  /** 세션 연속성 키 — 패널 id */
  sessionId: string;
  projectId: string;
  projectPath?: string;
  /** 이번 턴의 새 user 메시지 */
  message: string;
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/** Hermes 가 보내는 원본 SSE 이벤트 (필드는 이벤트 종류마다 다름) */
interface RawRunEvent {
  event?: string;
  run_id?: string;
  delta?: string;
  tool?: string;
  preview?: string;
  duration?: number;
  error?: boolean | string;
  output?: string;
  command?: string;
  description?: string;
  choices?: string[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

function mapEvent(ev: RawRunEvent): RunEvent | null {
  switch (ev.event) {
    case 'tool.started':
      return { type: 'tool-start', tool: ev.tool ?? '', preview: ev.preview ?? '' };
    case 'tool.completed':
      return {
        type: 'tool-end',
        tool: ev.tool ?? '',
        duration: typeof ev.duration === 'number' ? ev.duration : 0,
        error: Boolean(ev.error),
      };
    case 'message.delta':
    case 'text.delta':
      return ev.delta ? { type: 'text', delta: ev.delta } : null;
    case 'approval.request':
      return {
        type: 'approval',
        runId: ev.run_id ?? '',
        command: ev.command ?? '',
        description: ev.description ?? '',
        choices: ev.choices ?? ['once', 'session', 'always', 'deny'],
      };
    case 'approval.responded':
      return { type: 'approval-resolved' };
    case 'run.completed':
    case 'run.cancelled':
      return {
        type: 'done',
        output: ev.output ?? '',
        usage: ev.usage
          ? { input: ev.usage.input_tokens ?? 0, output: ev.usage.output_tokens ?? 0 }
          : undefined,
      };
    case 'run.failed':
      return { type: 'error', message: typeof ev.error === 'string' ? ev.error : '런 실패' };
    default:
      return null;
  }
}

/** 에이전트 런을 시작하고 정규화된 이벤트를 순차 yield 한다 */
export async function* streamRun(opts: StreamRunOptions): AsyncGenerator<RunEvent> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const key = opts.apiKey ?? DEFAULT_KEY;

  let content = `${opts.message}\n\n${PROJECT_MARKER}${opts.projectId}`;
  if (opts.projectPath && opts.projectPath.trim()) {
    content += `\n${CWD_MARKER}${opts.projectPath.trim()}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Hermes-Session-Id': opts.sessionId,
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };

  // 1) 런 생성
  const createRes = await httpFetch(`${base}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: content }),
    signal: opts.signal,
  });
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '');
    throw new HermesApiError(createRes.status, detail.slice(0, 300));
  }
  const created = (await createRes.json()) as { run_id?: string };
  const runId = created.run_id;
  if (!runId) throw new HermesApiError(500, '응답에 run_id 가 없음');

  // 중단 시 서버측 런도 정지
  const onAbort = () => {
    httpFetch(`${base}/runs/${runId}/stop`, { method: 'POST', headers }).catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort);

  try {
    // 2) 이벤트 SSE 스트림
    const evRes = await httpFetch(`${base}/runs/${runId}/events`, { headers, signal: opts.signal });
    if (!evRes.ok || !evRes.body) {
      const detail = await evRes.text().catch(() => '');
      throw new HermesApiError(evRes.status, detail.slice(0, 300));
    }

    const reader = evRes.body.getReader();
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
        if (!data || data === '[DONE]') continue;

        let raw: RawRunEvent;
        try {
          raw = JSON.parse(data) as RawRunEvent;
        } catch {
          continue; // keepalive / 부분 청크
        }
        const mapped = mapEvent(raw);
        if (mapped) yield mapped;
        if (raw.event === 'run.completed' || raw.event === 'run.failed'
            || raw.event === 'run.cancelled') {
          return;
        }
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** 대기 중인 승인 요청을 해소한다 (choice: once|session|always|deny) */
export async function approveRun(
  runId: string,
  choice: string,
  opts?: { baseUrl?: string; apiKey?: string },
): Promise<void> {
  const base = opts?.baseUrl ?? DEFAULT_BASE;
  const key = opts?.apiKey ?? DEFAULT_KEY;
  const res = await httpFetch(`${base}/runs/${runId}/approval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ choice }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HermesApiError(res.status, detail.slice(0, 300));
  }
}
