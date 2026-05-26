// dockview 커스텀 탭 — 더블클릭 이름편집 / ✕ 닫기 / 우클릭 메뉴(다른 탭으로 이동).
// defaultTabComponent 로 등록하면 모든 패널 탭에 적용된다.

import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { useProjects } from '../store/projects';

export function PanelTab({ api, params }: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(api.title ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { projects, activeId } = useProjects();
  const active = projects.find((p) => p.id === activeId);
  const otherTabs = active?.tabs.filter((t) => t.id !== active.activeTabId) ?? [];

  useEffect(() => {
    const sub = api.onDidTitleChange((e) => setTitle(e.title));
    return () => sub.dispose();
  }, [api]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  function startEdit() {
    setDraft(title);
    setEditing(true);
  }
  function commit() {
    const next = draft.trim();
    if (next && next !== title) api.setTitle(next);
    setEditing(false);
  }

  function moveToTab(targetTabId: string) {
    // 1) 패널의 component / params / id / title 캡쳐
    // 2) 'hermes:move-panel-to-tab' 이벤트 → Workspace 가 처리
    //    (close + 대상 탭에 pending add 큐잉 → 탭 전환 → 큐 적용)
    const detail = {
      panelId: api.id,
      title,
      params: params ?? {},
      targetTabId,
    };
    window.dispatchEvent(new CustomEvent('hermes:move-panel-to-tab', { detail }));
    setMenu(null);
  }

  return (
    <div
      className="tab"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="tab-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="tab-label" onDoubleClick={startEdit} title="더블클릭: 이름 / 우클릭: 메뉴">
          {title}
        </span>
      )}
      <button
        className="tab-close"
        title="닫기"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); api.close(); }}
      >
        ✕
      </button>

      {menu && (
        <div
          className="paneltab-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="paneltab-menu-head">패널 이동</div>
          {otherTabs.length === 0 ? (
            <div className="paneltab-menu-empty">다른 탭 없음</div>
          ) : (
            otherTabs.map((t) => (
              <button
                key={t.id}
                className="paneltab-menu-item"
                onClick={() => moveToTab(t.id)}
              >
                → {t.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
