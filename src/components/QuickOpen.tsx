// 파일 빠른 열기 (Ctrl+P) — fs_walk 결과를 fuzzy 매치로 필터링.
// Enter → 'hermes:open-file' 윈도우 이벤트 발행. App.tsx 의 핸들러가 패널을 연다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { walkFiles, type WalkEntry } from '../api/fs';
import { isTauri } from '../runtime';

interface QuickOpenProps {
  root: string;
  onClose: () => void;
}

function fuzzyScore(query: string, target: string): number {
  // subsequence 매칭 + 연속 매치 가산점. 매치 실패면 -1.
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1;
  return score;
}

export function QuickOpen({ root, onClose }: QuickOpenProps) {
  const [files, setFiles] = useState<WalkEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    inputRef.current?.focus();
    if (!isTauri) {
      setError('Tauri 전용');
      setLoading(false);
      return;
    }
    walkFiles(root)
      .then((res) => { if (!cancelled) setFiles(res); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return files.slice(0, 200);
    const scored: { entry: WalkEntry; score: number }[] = [];
    for (const f of files) {
      const score = fuzzyScore(q, f.rel);
      if (score >= 0) scored.push({ entry: f, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 200).map((s) => s.entry);
  }, [files, query]);

  useEffect(() => {
    if (selected >= filtered.length) setSelected(0);
  }, [filtered, selected]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  function openEntry(entry: WalkEntry) {
    onClose();
    window.dispatchEvent(new CustomEvent('hermes:open-file', {
      detail: { filePath: entry.path },
    }));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = filtered[selected];
      if (entry) openEntry(entry);
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
          placeholder={`파일 검색… (${files.length}개 인덱싱)`}
          spellCheck={false}
        />
        <div className="picker-list cmdp-list" ref={listRef}>
          {loading && <div className="picker-dim">파일 목록 불러오는 중…</div>}
          {error && <div className="chat-error">⚠ {error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="picker-dim">일치하는 파일 없음</div>
          )}
          {filtered.map((f, i) => (
            <button
              key={f.path}
              data-idx={i}
              className={`picker-row cmdp-row${i === selected ? ' cmdp-row-sel' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => openEntry(f)}
            >
              <span className="cmdp-label">{f.name}</span>
              <span className="cmdp-group qopen-rel">{f.rel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
