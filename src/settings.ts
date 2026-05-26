// 앱 설정 — 외형/채팅/에디터/파일/단축키. localStorage 영속 + 일부는 CSS 변수로 적용.

import { DEFAULT_KEYMAP, type ShortcutAction } from './keybindings';

/** 채팅 백엔드 — 새 세션 탭 만들 때 자동 선택 */
export type ChatProvider = 'hermes' | 'claude';

export interface Settings {
  // ── 외형 ──
  theme: 'light' | 'dark';
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  accentColor: string;
  codeFontSize: number;
  // ── 채팅 ──
  /** 새 세션 탭 만들 때 사용할 백엔드 */
  chatProvider: ChatProvider;
  /** true: Enter 전송·Shift+Enter 줄바꿈 / false: 반대 */
  enterToSend: boolean;
  showTokenUsage: boolean;
  showTiming: boolean;
  autoScroll: boolean;
  // ── 에디터 ──
  autoSave: boolean;
  lineNumbers: boolean;
  wordWrap: boolean;
  tabSize: number;
  mdLivePreview: boolean;
  // ── 파일 ──
  showHiddenFiles: boolean;
  fileSortOrder: 'name-asc' | 'name-desc';
  // ── 단축키 ──
  keymap: Record<ShortcutAction, string>;
}

export const FONT_OPTIONS = [
  {
    key: 'mono',
    label: '모노스페이스',
    stack: "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace",
  },
  {
    key: 'sans',
    label: '산세리프',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif",
  },
  {
    key: 'serif',
    label: '세리프',
    stack: "Georgia, 'Noto Serif KR', 'Apple SD Gothic Neo', serif",
  },
] as const;

export const WEIGHT_OPTIONS = [
  { value: 300, label: '가늘게' },
  { value: 400, label: '보통' },
  { value: 500, label: '중간' },
  { value: 700, label: '굵게' },
] as const;

export const DEFAULTS: Settings = {
  theme: 'light',
  fontFamily: 'mono',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.5,
  accentColor: '#3b6fe0',
  codeFontSize: 12,
  chatProvider: 'hermes',
  enterToSend: true,
  showTokenUsage: false,
  showTiming: true,
  autoScroll: true,
  autoSave: false,
  lineNumbers: true,
  wordWrap: false,
  tabSize: 4,
  mdLivePreview: true,
  showHiddenFiles: true,
  fileSortOrder: 'name-asc',
  keymap: { ...DEFAULT_KEYMAP },
};

const STORAGE_KEY = 'hermes-web:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // 누락 필드는 기본값으로 채움 (스키마 확장 대비) + keymap 머지
    return {
      ...DEFAULTS,
      ...parsed,
      keymap: { ...DEFAULT_KEYMAP, ...(parsed.keymap ?? {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 저장 실패 무시
  }
}

/** CSS 변수·data-theme 로 적용되는 설정들을 :root 에 반영 */
export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  const font = FONT_OPTIONS.find((f) => f.key === settings.fontFamily) ?? FONT_OPTIONS[0];
  root.dataset.theme = settings.theme;
  root.style.setProperty('--ui-font', font.stack);
  root.style.setProperty('--ui-size', `${settings.fontSize}px`);
  root.style.setProperty('--ui-weight', String(settings.fontWeight));
  root.style.setProperty('--ui-line', String(settings.lineHeight));
  root.style.setProperty('--accent', settings.accentColor);
  root.style.setProperty('--code-size', `${settings.codeFontSize}px`);
}
