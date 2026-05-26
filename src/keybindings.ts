// 전역 단축키. 데스크톱 앱 형태로 갈 것이므로 Ctrl/Cmd 기반 — 브라우저에선 일부 충돌.
// 입력 위젯(textarea/input/contenteditable)에 포커스 있을 땐 무시(컴포저 입력 방해 방지).

import { useEffect } from 'react';

export interface Shortcuts {
  newSessionTab: () => void;
  newSessionSplit: () => void;
  closeActivePanel: () => void;
  openSettings: () => void;
  openFolder: () => void;
  toggleFileTree: () => void;
  previewActive: () => void;
  openSearch: () => void;
  openSessions: () => void;
  /** index = 1..9 → 해당 프로젝트로 전환 */
  switchProject: (index: number) => void;
}

/** 포커스 노드가 텍스트 입력 중인지 */
function isEditing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  // CodeMirror — .cm-content 가 contenteditable=true 라 위에서 잡힘
  return false;
}

export function useGlobalShortcuts(s: Shortcuts): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // 편집 중에도 동작해야 하는 단축키 (Ctrl+,/Ctrl+B 등 메뉴 류)
      // 패널/프로젝트 조작은 편집 중이면 막는다
      const editing = isEditing(e.target);

      // Ctrl+, → 설정
      if (e.key === ',') { e.preventDefault(); s.openSettings(); return; }
      // Ctrl+B → 파일트리 토글
      if (e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault(); s.toggleFileTree(); return;
      }
      // Ctrl+O → 폴더 열기
      if (e.key.toLowerCase() === 'o' && !e.shiftKey) {
        e.preventDefault(); s.openFolder(); return;
      }
      // Ctrl+Shift+F → 프로젝트 전체 검색
      if (e.key.toLowerCase() === 'f' && e.shiftKey) {
        e.preventDefault(); s.openSearch(); return;
      }
      // Ctrl+Shift+H → 세션 기록 브라우저
      if (e.key.toLowerCase() === 'h' && e.shiftKey) {
        e.preventDefault(); s.openSessions(); return;
      }

      if (editing) return;

      // Ctrl+N → 새 세션 탭, Ctrl+Shift+N → 새 세션 분할
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (e.shiftKey) s.newSessionSplit(); else s.newSessionTab();
        return;
      }
      // Ctrl+W → 활성 패널 닫기
      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        e.preventDefault(); s.closeActivePanel(); return;
      }
      // Ctrl+P → 활성 HTML 프리뷰
      if (e.key.toLowerCase() === 'p' && !e.shiftKey) {
        e.preventDefault(); s.previewActive(); return;
      }
      // Ctrl+1..9 → 프로젝트 전환
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault(); s.switchProject(parseInt(e.key, 10)); return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);
}
