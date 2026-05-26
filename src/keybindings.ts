// 전역 단축키 — 사용자 정의 가능 (Settings → 단축키 탭).
// 데스크톱 앱 형태로 갈 것이므로 Ctrl/Cmd 기반. 입력 위젯 포커스 시
// 일부 액션(allowEditing=false)은 차단해 컴포저 입력을 방해 안 함.

import { useEffect } from 'react';

export type ShortcutAction =
  | 'newSessionTab'
  | 'newSessionSplitH'
  | 'newSessionSplitV'
  | 'closeActivePanel'
  | 'openSettings'
  | 'openFolder'
  | 'toggleFileTree'
  | 'previewActive'
  | 'openSearch'
  | 'openSessions';

export interface Shortcuts {
  newSessionTab: () => void;
  /** 가로 분할 — 오른쪽 */
  newSessionSplitH: () => void;
  /** 세로 분할 — 아래쪽 */
  newSessionSplitV: () => void;
  closeActivePanel: () => void;
  openSettings: () => void;
  openFolder: () => void;
  toggleFileTree: () => void;
  previewActive: () => void;
  openSearch: () => void;
  openSessions: () => void;
  /** index = 1..9 → 해당 프로젝트 전환 (Ctrl+1..9 고정, 사용자 정의 불가) */
  switchProject: (index: number) => void;
}

export interface ActionSpec {
  id: ShortcutAction;
  label: string;
  /** true 면 input/textarea 포커스 중에도 발동 (메뉴 류) */
  allowEditing: boolean;
}

/** 사용자에게 노출하는 액션 목록. 표시 순서 = 정의 순서 */
export const ACTIONS: readonly ActionSpec[] = [
  { id: 'newSessionTab',     label: '새 세션 탭',           allowEditing: false },
  { id: 'newSessionSplitH',  label: '새 세션 가로 분할(↔)', allowEditing: false },
  { id: 'newSessionSplitV',  label: '새 세션 세로 분할(↕)', allowEditing: false },
  { id: 'closeActivePanel', label: '활성 패널 닫기',     allowEditing: false },
  { id: 'previewActive',    label: '활성 HTML 프리뷰',   allowEditing: false },
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
  closeActivePanel:  'Ctrl+W',
  openSettings:     'Ctrl+,',
  openFolder:       'Ctrl+O',
  toggleFileTree:   'Ctrl+B',
  previewActive:    'Ctrl+P',
  openSearch:       'Ctrl+Shift+F',
  openSessions:     'Ctrl+Shift+H',
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
      // Ctrl+1..9 → 프로젝트 전환 (고정)
      if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        s.switchProject(parseInt(e.key, 10));
        return;
      }
      if (!mod) return;

      const combo = keyEventToCombo(e);
      if (!combo) return;
      const editing = isEditing(e.target);

      // 매칭되는 액션 찾기
      for (const [id, bound] of Object.entries(keymap) as [ShortcutAction, string][]) {
        if (bound !== combo) continue;
        const spec = ACTION_BY_ID[id];
        if (!spec) continue;
        if (editing && !spec.allowEditing) return;
        e.preventDefault();
        s[id]();
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, keymap]);
}
