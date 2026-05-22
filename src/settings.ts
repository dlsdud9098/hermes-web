// 앱 설정 — localStorage 영속. Hermes 연결 정보를 런타임에 바꿀 수 있게 한다.
// (.env 는 빌드타임 고정이라 재빌드가 필요 — 설정으로 덮어쓴다.)

export interface Settings {
  /** Hermes API 베이스 URL. 빈 값이면 .env 또는 프록시 기본값 사용 */
  hermesBaseUrl: string;
  /** Hermes API_SERVER_KEY. 빈 값이면 .env 값 사용 */
  hermesKey: string;
}

const STORAGE_KEY = 'hermes-web:settings:v1';
const DEFAULTS: Settings = { hermesBaseUrl: '', hermesKey: '' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      hermesBaseUrl: parsed.hermesBaseUrl ?? '',
      hermesKey: parsed.hermesKey ?? '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 저장 실패해도 무시 — 이번 세션 동안은 메모리상 값으로 동작
  }
}
