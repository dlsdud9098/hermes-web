// 앱 외형 설정 — 글씨 크기·굵기·폰트. localStorage 영속 + CSS 변수로 적용.

export interface Settings {
  /** FONT_OPTIONS 의 key */
  fontFamily: string;
  /** px */
  fontSize: number;
  /** CSS font-weight */
  fontWeight: number;
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

const STORAGE_KEY = 'hermes-web:settings:v1';
const DEFAULTS: Settings = { fontFamily: 'mono', fontSize: 13, fontWeight: 400 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      fontFamily: typeof p.fontFamily === 'string' ? p.fontFamily : DEFAULTS.fontFamily,
      fontSize: typeof p.fontSize === 'number' ? p.fontSize : DEFAULTS.fontSize,
      fontWeight: typeof p.fontWeight === 'number' ? p.fontWeight : DEFAULTS.fontWeight,
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

/** 설정을 CSS 변수로 :root 에 적용 */
export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  const font = FONT_OPTIONS.find((f) => f.key === settings.fontFamily) ?? FONT_OPTIONS[0];
  root.style.setProperty('--ui-font', font.stack);
  root.style.setProperty('--ui-size', `${settings.fontSize}px`);
  root.style.setProperty('--ui-weight', String(settings.fontWeight));
}
