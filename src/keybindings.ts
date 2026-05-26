// 전역 단축키 — 사용자 정의 가능 (Settings → 단축키 탭).
// 데스크톱 앱 형태로 갈 것이므로 Ctrl/Cmd 기반. 입력 위젯 포커스 시
// 일부 액션(allowEditing=false)은 차단해 컴포저 입력을 방해 안 함.

import { useEffect } from 'react';

export type ShortcutAction =
  | 'newSessionTab'
  | 'newSessionSplitH'
  | 'newSessionSplitV'
  | 'closeActiveTab'
  | 'closeActivePanel'
  | 'openSettings'
  | 'openFolder'
  | 'toggleFileTree'
  | 'previewActive'
  | 'openSearch'
  | 'openSessions'
  | 'openCommandPalette'
  | 'quickOpen'
  | 'cycleRecentTab';

export interface Shortcuts {
  newSessionTab: () => void;
  /** 가로 분할 — 위아래 배치 */
  newSessionSplitH: () => void;
  /** 세로 분할 — 좌우 배치 */
  newSessionSplitV: () => void;
  /** 탭 닫기 — 같은 tabId 묶음(분할 모두 포함) 통째로 close */
  closeActiveTab: () => void;
  /** 활성 패널 1개만 close (같은 탭의 다른 분할은 유지) */
  closeActivePanel: () => void;
  openSettings: () => void;
  openFolder: () => void;
  toggleFileTree: () => void;
  previewActive: () => void;
  openSearch: () => void;
  openSessions: () => void;
  /** Ctrl+Shift+P — 명령 팔레트 */
  openCommandPalette: () => void;
  /** Ctrl+P — 파일 빠른 열기 */
  quickOpen: () => void;
  /** Ctrl+` — 최근 활성화한 탭으로 토글 */
  cycleRecentTab: () => void;
  /** Ctrl+Alt+1..9 — 프로젝트 전환 */
  switchProject: (index: number) => void;
  /** Ctrl+1..9 — 현재 프로젝트의 N번째 탭 전환 */
  switchTab: (index: number) => void;
  /** Ctrl+Shift+1..9 — 현재 탭 dockview 의 N번째 패널 활성화 */
  switchPanel: (index: number) => void;
}

export interface ActionSpec {
  id: ShortcutAction;
  label: string;
  /** true 면 input/textarea 포커스 중에도 발동 (메뉴 류) */
  allowEditing: boolean;
}

/** 사용자에게 노출하는 액션 목록. 표시 순서 = 정의 순서 */
export const ACTIONS: readonly ActionSpec[] = [
  { id: 'newSessionTab',     label: '새 세션 탭',                    allowEditing: false },
  { id: 'newSessionSplitH',  label: '새 세션 가로 분할(─, 위아래)',  allowEditing: false },
  { id: 'newSessionSplitV',  label: '새 세션 세로 분할(│, 좌우)',    allowEditing: false },
  { id: 'closeActiveTab',    label: '탭 닫기 (안의 모든 분할 포함)', allowEditing: false },
  { id: 'closeActivePanel',  label: '활성 패널만 닫기',              allowEditing: false },
  { id: 'previewActive',    label: '활성 HTML 프리뷰',   allowEditing: false },
  { id: 'openCommandPalette', label: '명령 팔레트',      allowEditing: true  },
  { id: 'quickOpen',        label: '파일 빠른 열기',     allowEditing: true  },
  { id: 'cycleRecentTab',   label: '최근 탭 토글',       allowEditing: false },
  { id: 'openSearch',       label: '프로젝트 전체 검색', allowEditing: true  },
  { id: 'openSessions',     label: '세션 기록 브라우저', allowEditing: true  },
  { id: 'toggleFileTree',   label: '파일 트리 토글',     allowEditing: true  },
  { id: 'openFolder',       label: '폴더 열기',          allowEditing: true  },
  { id: 'openSettings',     label: '설정 열기',          allowEditing: true  },
];

export const DEFAULT_KEYMAP: Record<ShortcutAction, string> = {
  newSessionTab:     'Ctrl+N',
  newSessionSplitH:  'Ctrl+Shift+N',
  newSessionSplitV:  'Ctrl+Alt+N',
  closeActiveTab:    'Ctrl+W',
  closeActivePanel:  'Ctrl+Shift+W',
  openSettings:     'Ctrl+,',
  openFolder:       'Ctrl+O',
  toggleFileTree:   'Ctrl+B',
  previewActive:    'Ctrl+Shift+V',
  openSearch:       'Ctrl+Shift+F',
  openSessions:     'Ctrl+Shift+H',
  openCommandPalette: 'Ctrl+Shift+P',
  quickOpen:        'Ctrl+P',
  cycleRecentTab:   'Ctrl+`',
};

/** KeyboardEvent → 표준 콤보 문자열 (Ctrl+Shift+F 등) */
export function keyEventToCombo(e: KeyboardEvent): string | null {
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt'
      || e.key === 'Meta' || e.key === 'OS') return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k === 'Escape') k = 'Esc';
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join('+');
}

function isEditing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

const ACTION_BY_ID: Record<ShortcutAction, ActionSpec> =
  Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ShortcutAction, ActionSpec>;

export function useGlobalShortcuts(
  s: Shortcuts,
  keymap: Record<ShortcutAction, string>,
): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+(Shift|Alt)+1..9 — 고정 단축키 (사용자 정의 불가)
      if (mod && /^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10);
        e.preventDefault();
        if (e.altKey) s.switchProject(n);
        else if (e.shiftKey) s.switchPanel(n);
        else s.switchTab(n);
        return;
      }

      const combo = keyEventToCombo(e);
      if (!combo) return; // modifier-only
      const editing = isEditing(e.target);

      // 매칭되는 액션 찾기 — modifier 강제 없음 (사용자가 F5/Alt+X 등 자유 지정 가능)
      for (const [id, bound] of Object.entries(keymap) as [ShortcutAction, string][]) {
        if (bound !== combo) continue;
        const spec = ACTION_BY_ID[id];
        if (!spec) continue;
        if (editing && !spec.allowEditing) return;
        e.preventDefault();
        e.stopPropagation();
        s[id]();
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, keymap]);
}
