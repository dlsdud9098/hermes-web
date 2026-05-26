// 외부 코딩 에이전트 세션 기록 브라우저 (모달).
// 탭으로 Claude Code / Codex 분리. 클릭하면 SessionViewer 패널을 dockview 에 연다.

import { useEffect, useMemo, useState } from 'react';
import { listSessions, refreshSessions, type SessionMeta, type SessionSource } from '../api/sessions';
import { isTauri } from '../runtime';

interface Props {
  onClose: () => void;
  onOpen: (s: SessionMeta) => void;
}

function fmtDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return '방금';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}일 전`;
  return d.toLocaleDateString();
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function SessionBrowser({ onClose, onOpen }: Props) {
  const [source, setSource] = useState<SessionSource>('claude');
  const [items, setItems] = useState<SessionMeta[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isTauri) {
      setError('세션 기록은 Tauri 데스크톱 모드에서만 조회됩니다');
      return;
    }
    setLoading(true);
    setError(null);
    listSessions(source)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [source]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.cwd ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sessions-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">세션 기록 (Claude / Codex)</span>
          <button className="picker-x" onClick={onClose}>✕</button>
        </div>

        <div className="sessions-tabs">
          {(['claude', 'codex', 'all'] as const).map((s) => (
            <button
              key={s}
              className={`sessions-tab${source === s ? ' sessions-tab-active' : ''}`}
              onClick={() => setSource(s)}
            >
              {s === 'claude' ? 'Claude Code' : s === 'codex' ? 'Codex' : '전체'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '0 12px 8px' }}>
          <input
            className="sessions-search"
            style={{ flex: 1, margin: 0 }}
            placeholder="제목·경로 검색… (캐시된 인덱스)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await refreshSessions();
              const next = await listSessions(source);
              setItems(next);
            }}
            title="디스크 재스캔"
          >
            ↻
          </button>
        </div>

        {error && <div className="chat-error">⚠ {error}</div>}
        {loading && <div className="fileviewer-note">로딩…</div>}

        <div className="sessions-list">
          {filtered.length === 0 && !loading && !error && (
            <div className="chat-empty">세션 없음</div>
          )}
          {filtered.map((s) => (
            <button
              key={s.file}
              className="sessions-item"
              onClick={() => { onOpen(s); onClose(); }}
              title={s.file}
            >
              <div className="sessions-item-head">
                <span className={`sessions-badge sessions-badge-${s.source}`}>
                  {s.source === 'claude' ? 'Claude' : 'Codex'}
                </span>
                <span className="sessions-title">{s.title}</span>
                <span className="sessions-meta-right">
                  {fmtSize(s.size)} · {fmtDate(s.modified_ms)}
                </span>
              </div>
              {s.cwd && <div className="sessions-cwd">{s.cwd}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
