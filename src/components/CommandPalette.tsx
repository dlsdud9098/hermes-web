// 명령 팔레트 (Ctrl+Shift+P) — 검색 입력 + 필터링 명령 리스트.
// FolderPicker 와 동일한 modal-overlay/picker 스타일 패턴을 따른다.
// 퍼지 매칭은 subsequence — 의존성 없이 가볍게.

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  group: string;
  run: () => void;
  shortcut?: string;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

/** subsequence 퍼지 매치 — query 의 각 문자가 target 안에서 순서대로 나오면 매치 */
function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return commands;
    return commands.filter((c) => fuzzyMatch(q, `${c.label} ${c.group}`));
  }, [commands, query]);

  // 필터링 결과가 줄어들면 selected 가 범위 밖일 수 있다
  useEffect(() => {
    if (selected >= filtered.length) setSelected(0);
  }, [filtered, selected]);

  // 선택된 항목을 보이도록 스크롤
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) {
        onClose();
        // close 가 unmount 트리거하기 전에 run 호출 — 같은 tick 동기 실행
        cmd.run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker cmdp" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="picker-path-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="명령 검색…"
          spellCheck={false}
        />
        <div className="picker-list cmdp-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="picker-dim">일치하는 명령 없음</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              data-idx={i}
              className={`picker-row cmdp-row${i === selected ? ' cmdp-row-sel' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                onClose();
                c.run();
              }}
            >
              <span className="cmdp-group">{c.group}</span>
              <span className="cmdp-label">{c.label}</span>
              {c.shortcut && <span className="cmdp-shortcut">{c.shortcut}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
