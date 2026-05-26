// 앱 설정 — 외형/채팅/에디터/파일/단축키. localStorage 영속 + 일부는 CSS 변수로 적용.

import { DEFAULT_KEYMAP, type ShortcutAction } from './keybindings';

/** 채팅 백엔드 — 새 세션 탭 만들 때 자동 선택 */
export type ChatProvider = 'hermes' | 'claude';

export interface ThemePresetVars {
  bg: string;
  bgRail: string;
  bgBar: string;
  bgPanel: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
}

export interface ThemePreset {
  id: string;
  label: string;
  mode: 'light' | 'dark';
  vars: ThemePresetVars;
}

/** 빌트인 테마 프리셋. id 는 영속 식별자 — 변경 금지. */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'default-light',
    label: '기본 라이트',
    mode: 'light',
    vars: {
      bg: '#f6f6f7', bgRail: '#ececed', bgBar: '#f0f0f1', bgPanel: '#ffffff',
      border: '#d9d9de', text: '#1a1b26', textDim: '#8a8a93', accent: '#3b6fe0',
    },
  },
  {
    id: 'default-dark',
    label: '기본 다크',
    mode: 'dark',
    vars: {
      bg: '#16161e', bgRail: '#101014', bgBar: '#1a1b26', bgPanel: '#1e2030',
      border: '#2a2c3d', text: '#c0caf5', textDim: '#565f89', accent: '#3b6fe0',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    vars: {
      bg: '#282a36', bgRail: '#21222c', bgBar: '#21222c', bgPanel: '#343746',
      border: '#44475a', text: '#f8f8f2', textDim: '#6272a4', accent: '#bd93f9',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    mode: 'dark',
    vars: {
      bg: '#1a1b26', bgRail: '#16161e', bgBar: '#16161e', bgPanel: '#24283b',
      border: '#414868', text: '#c0caf5', textDim: '#7aa2f7', accent: '#bb9af7',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    mode: 'light',
    vars: {
      bg: '#fdf6e3', bgRail: '#eee8d5', bgBar: '#eee8d5', bgPanel: '#fdf6e3',
      border: '#93a1a1', text: '#586e75', textDim: '#93a1a1', accent: '#268bd2',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    mode: 'dark',
    vars: {
      bg: '#002b36', bgRail: '#001f27', bgBar: '#073642', bgPanel: '#073642',
      border: '#586e75', text: '#93a1a1', textDim: '#657b83', accent: '#268bd2',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    vars: {
      bg: '#2e3440', bgRail: '#272c36', bgBar: '#3b4252', bgPanel: '#3b4252',
      border: '#434c5e', text: '#eceff4', textDim: '#81a1c1', accent: '#88c0d0',
    },
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    mode: 'light',
    vars: {
      bg: '#ffffff', bgRail: '#f6f8fa', bgBar: '#f6f8fa', bgPanel: '#ffffff',
      border: '#d0d7de', text: '#1f2328', textDim: '#656d76', accent: '#0969da',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    mode: 'dark',
    vars: {
      bg: '#272822', bgRail: '#1e1f1c', bgBar: '#1e1f1c', bgPanel: '#3e3d32',
      border: '#49483e', text: '#f8f8f2', textDim: '#75715e', accent: '#a6e22e',
    },
  },
];

export function getPreset(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

export interface Settings {
  // ── 외형 ──
  /** 프리셋의 mode 에서 파생되지만 하위호환 위해 유지 */
  theme: 'light' | 'dark';
  /** 활성 테마 프리셋 id (THEME_PRESETS 중 하나) */
  themePreset: string;
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
  themePreset: 'default-light',
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
    // themePreset 이 없으면 기존 theme 값에서 파생 (하위호환)
    const themePreset =
      parsed.themePreset ?? (parsed.theme === 'dark' ? 'default-dark' : 'default-light');
    return {
      ...DEFAULTS,
      ...parsed,
      themePreset,
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
  const preset = getPreset(settings.themePreset);
  // 프리셋의 mode 가 data-theme 의 단일 소스. (color-scheme 등 CSS 디폴트용)
  root.dataset.theme = preset.mode;
  // 프리셋 팔레트를 인라인 var 로 덮어씀
  root.style.setProperty('--bg', preset.vars.bg);
  root.style.setProperty('--bg-rail', preset.vars.bgRail);
  root.style.setProperty('--bg-bar', preset.vars.bgBar);
  root.style.setProperty('--bg-panel', preset.vars.bgPanel);
  root.style.setProperty('--border', preset.vars.border);
  root.style.setProperty('--text', preset.vars.text);
  root.style.setProperty('--text-dim', preset.vars.textDim);
  root.style.setProperty('--ui-font', font.stack);
  root.style.setProperty('--ui-size', `${settings.fontSize}px`);
  root.style.setProperty('--ui-weight', String(settings.fontWeight));
  root.style.setProperty('--ui-line', String(settings.lineHeight));
  // 강조색 — 프리셋 기본값을 쓰되, 사용자가 accentColor 를 명시적으로 바꿨으면 그게 우선.
  // 정책: settings.accentColor 가 항상 final 값이고, 프리셋 선택 시 store 에서 함께 갱신.
  root.style.setProperty('--accent', settings.accentColor);
  root.style.setProperty('--code-size', `${settings.codeFontSize}px`);
}
