// 폴더 피커 모달 — 게이트웨이 호스트의 디렉토리를 트리 탐색해 절대경로를 고른다.
// 클릭=폴더 진입, 더블클릭/「이 폴더 선택」=선택.

import { useCallback, useEffect, useState } from 'react';
import { listDir, type DirListing } from '../api/fs';

interface FolderPickerProps {
  onPick: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({ onPick, onClose }: FolderPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 경로 입력란 draft — listing 변하면 동기화, 사용자 타이핑은 자유 편집
  const [pathDraft, setPathDraft] = useState('');

  const go = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await listDir(path);
      setListing(next);
      setPathDraft(next.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { go(); }, [go]);

  const submitPath = () => {
    const p = pathDraft.trim();
    if (p) void go(p);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">폴더 열기</span>
          <button className="picker-x" onClick={onClose}>✕</button>
        </div>
        <input
          className="picker-path-input"
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitPath(); }
            else if (e.key === 'Escape') { e.preventDefault(); setPathDraft(listing?.path ?? ''); }
          }}
          spellCheck={false}
          placeholder="경로 입력 후 Enter (예: /home/inyoung/projects)"
        />
        <div className="picker-list">
          {loading && <div className="picker-dim">불러오는 중…</div>}
          {error && <div className="chat-error">⚠ {error}</div>}
          {!loading && !error && listing && (
            <>
              {listing.parent && (
                <button className="picker-row" onClick={() => go(listing.parent ?? undefined)}>
                  <span className="picker-ic">↑</span> ..
                </button>
              )}
              {listing.dirs.map((d) => (
                <button
                  key={d.path}
                  className="picker-row"
                  onClick={() => go(d.path)}
                  onDoubleClick={() => onPick(d.path)}
                  title="클릭: 열기 · 더블클릭: 선택"
                >
                  <span className="picker-ic">📁</span> {d.name}
                </button>
              ))}
              {listing.dirs.length === 0 && (
                <div className="picker-dim">하위 폴더 없음</div>
              )}
            </>
          )}
        </div>
        <div className="picker-foot">
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
          <button
            className="btn"
            disabled={!listing}
            onClick={() => listing && onPick(listing.path)}
          >
            이 폴더 선택
          </button>
        </div>
      </div>
    </div>
  );
}
