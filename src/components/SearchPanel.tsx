// 프로젝트 전체 키워드 검색 패널 (VS Code 스타일).
// dockview 패널로 등록 — Ctrl+Shift+F 로 활성 프로젝트에서 연다.
// 매치된 라인 클릭 → FileViewer 패널로 해당 파일 열림.

import { useMemo, useState } from 'react';
import { searchInDir, type SearchHit } from '../api/search';

interface Props {
  projectPath: string;
  onOpenFile: (filePath: string, line: number) => void;
}

interface FileGroup {
  file: string;
  hits: SearchHit[];
}

function groupByFile(hits: SearchHit[]): FileGroup[] {
  const map = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const arr = map.get(h.file);
    if (arr) arr.push(h);
    else map.set(h.file, [h]);
  }
  return [...map.entries()].map(([file, hits]) => ({ file, hits }));
}

export function SearchPanel({ projectPath, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [ci, setCi] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const groups = useMemo(() => groupByFile(hits), [hits]);

  async function run() {
    if (!query.trim() || !projectPath) return;
    setBusy(true);
    setError(null);
    setSearched(true);
    try {
      const res = await searchInDir({
        root: projectPath,
        query: query,
        case_insensitive: ci,
        include_hidden: includeHidden,
        max_results: 500,
      });
      setHits(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  function shortName(file: string): string {
    if (file.startsWith(projectPath)) {
      return file.slice(projectPath.length).replace(/^[/\\]/, '');
    }
    return file;
  }

  return (
    <div className="searchpanel">
      <div className="searchpanel-bar">
        <input
          autoFocus
          className="searchpanel-input"
          placeholder="검색어…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
        />
        <button className="btn" disabled={busy || !query.trim()} onClick={() => void run()}>
          {busy ? '검색 중…' : '검색'}
        </button>
      </div>
      <div className="searchpanel-opts">
        <label>
          <input type="checkbox" checked={ci} onChange={(e) => setCi(e.target.checked)} />
          대소문자 무시
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(e) => setIncludeHidden(e.target.checked)}
          />
          숨김 파일 포함
        </label>
        {hits.length > 0 && (
          <span className="searchpanel-summary">
            {groups.length}개 파일 · {hits.length}개 매치
          </span>
        )}
      </div>

      {error && <div className="chat-error">⚠ {error}</div>}

      <div className="searchpanel-results">
        {searched && !busy && !error && hits.length === 0 && (
          <div className="chat-empty">매치 없음</div>
        )}
        {groups.map((g) => (
          <div key={g.file} className="search-group">
            <div className="search-file" title={g.file}>
              {shortName(g.file)} <span className="search-count">({g.hits.length})</span>
            </div>
            {g.hits.map((h, i) => (
              <button
                key={i}
                className="search-hit"
                onClick={() => onOpenFile(h.file, h.line)}
                title={`${g.file}:${h.line}`}
              >
                <span className="search-line">{h.line}</span>
                <span className="search-text">
                  {h.text.slice(0, h.match_start)}
                  <mark>{h.text.slice(h.match_start, h.match_end)}</mark>
                  {h.text.slice(h.match_end)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
