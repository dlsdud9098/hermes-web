// 도메인 타입 — 프로젝트(세로 탭) / 패널(세션) / 메시지

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Project {
  readonly id: string;
  name: string;
  color: string;
  /** dockview 직렬화 레이아웃. 프로젝트 전환 시 복원에 사용 */
  layout: unknown | null;
}

/** 한 패널 = 한 Hermes 세션. 메시지는 store 에서 panelId 로 보관 */
export interface PanelMeta {
  readonly id: string;
  readonly projectId: string;
}
