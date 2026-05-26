// 인앱 브라우저 패널 — iframe 기반.
// 한계: X-Frame-Options / Content-Security-Policy 로 차단된 사이트는 안 보임
//   (google.com 등). localhost / 개발 서버 / 자체 도메인은 잘 됨.
// 향후 Tauri 자식 webview 로 교체하면 우회 가능 (작업량 큼).

import { useEffect, useRef, useState } from 'react';

interface Props {
  initialUrl?: string;
}

function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/|$)/.test(t)) return `http://${t}`;
  if (/^\d+\.\d+\.\d+\.\d+/.test(t)) return `http://${t}`;
  // 도메인처럼 보이면 https
  if (/\.[a-z]{2,}/i.test(t)) return `https://${t}`;
  // 그 외 — 검색 (DuckDuckGo)
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}

export function BrowserPanel({ initialUrl = '' }: Props) {
  const [draft, setDraft] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { setDraft(url); }, [url]);

  function navigate(to: string) {
    const u = normalizeUrl(to);
    if (u) setUrl(u);
  }

  function reload() {
    setRefreshKey((k) => k + 1);
  }

  function back() {
    // iframe contentWindow.history.back — 같은 origin 제약
    try { iframeRef.current?.contentWindow?.history.back(); } catch { /* cross-origin */ }
  }
  function forward() {
    try { iframeRef.current?.contentWindow?.history.forward(); } catch { /* cross-origin */ }
  }

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="btn btn-ghost browser-nav" onClick={back} title="뒤로">◀</button>
        <button className="btn btn-ghost browser-nav" onClick={forward} title="앞으로">▶</button>
        <button className="btn btn-ghost browser-nav" onClick={reload} title="새로고침">⟳</button>
        <input
          className="browser-url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); navigate(draft); }
          }}
          placeholder="URL 또는 검색어 입력 (Enter)"
          spellCheck={false}
        />
        <button className="btn" onClick={() => navigate(draft)}>이동</button>
      </div>
      {url ? (
        <iframe
          key={refreshKey}
          ref={iframeRef}
          className="browser-frame"
          src={url}
          // sandbox — 보안. allow-same-origin 빼면 쿠키/스토리지 격리.
          // 일단 풀 — localhost 대상이라면 same-origin 필요.
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="browser-empty">
          URL 입력하고 Enter. localhost / 개발 서버 등은 잘 보임.<br />
          외부 사이트(google.com 등)는 X-Frame-Options 로 차단될 수 있음 — 그땐 시스템 브라우저로.
        </div>
      )}
    </div>
  );
}
