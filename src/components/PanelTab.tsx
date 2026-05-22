// dockview 커스텀 탭 — 더블클릭으로 제목 인라인 편집 + 닫기 버튼.
// defaultTabComponent 로 등록하면 모든 패널 탭에 적용된다.

import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';

export function PanelTab({ api }: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(api.title ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 다른 경로(레이아웃 복원 등)로 제목이 바뀌어도 동기화
  useEffect(() => {
    const sub = api.onDidTitleChange((e) => setTitle(e.title));
    return () => sub.dispose();
  }, [api]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEdit() {
    setDraft(title);
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    if (next && next !== title) api.setTitle(next);
    setEditing(false);
  }

  return (
    <div className="tab">
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
        <span className="tab-label" onDoubleClick={startEdit} title="더블클릭: 이름 수정">
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
    </div>
  );
}
