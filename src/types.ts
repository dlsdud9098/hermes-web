// 도메인 타입 — 프로젝트(세로 탭) / 패널(세션) / 메시지

/** 에이전트 턴 중 실행된 툴 호출 1건 */
export interface ToolCall {
  tool: string;
  /** 실행 미리보기 (예: 셸 명령) */
  preview: string;
  status: 'running' | 'done' | 'error';
  /** 완료까지 걸린 초 */
  duration?: number;
  /** Claude Code tool_use id (tool_result 와 매칭) */
  id?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** assistant 턴에서 실행된 툴들 (있을 때만) */
  tools?: ToolCall[];
  /** assistant 턴 토큰 사용량 */
  usage?: { input: number; output: number };
  /** assistant 턴 소요 시간 (ms) */
  durationMs?: number;
  /** 스트리밍 진행 중 (Claude Code 패널) */
  streaming?: boolean;
}

export interface Project {
  readonly id: string;
  name: string;
  color: string;
  /** 작업 폴더 절대경로(게이트웨이 호스트 기준). 빈 문자열이면 미지정 */
  path: string;
  /** dockview 직렬화 레이아웃. 프로젝트 전환 시 복원에 사용 */
  layout: unknown | null;
}

/** 한 패널 = 한 Hermes 세션. 메시지는 store 에서 panelId 로 보관 */
export interface PanelMeta {
  readonly id: string;
  readonly projectId: string;
}
