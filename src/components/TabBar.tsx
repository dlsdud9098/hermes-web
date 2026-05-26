// 워크스페이스 탭 바 — cmux/tmux window 모델.
// 각 탭은 독립된 dockview workspace. 탭 안에서 분할 패널들 자유 배치.

import { useState } from 'react';
import type { ProjectTab } from '../types';

interface Props {
  tabs: ProjectTab[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export function TabBar({ tabs, activeId, onSwitch, onAdd, onClose, onRename }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function startRename(t: ProjectTab) {
    setEditing(t.id);
    setDraft(t.name);
  }
  function commitRename() {
    if (editing && draft.trim()) onRename(editing, draft.trim());
    setEditing(null);
  }

  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tabbar-tab${t.id === activeId ? ' tabbar-tab-active' : ''}`}
          onClick={() => onSwitch(t.id)}
          onDoubleClick={() => startRename(t)}
          onAuxClick={(e) => { if (e.button === 1) onClose(t.id); }}
          title="더블클릭: 이름 변경 · 가운데클릭: 닫기"
        >
          {editing === t.id ? (
            <input
              className="tabbar-rename"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setEditing(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tabbar-name">{t.name}</span>
          )}
          <button
            className="tabbar-x"
            onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
            title="탭 닫기"
          >
            ✕
          </button>
        </div>
      ))}
      <button className="tabbar-add" onClick={onAdd} title="새 탭 (Ctrl+N)">+</button>
    </div>
  );
}
