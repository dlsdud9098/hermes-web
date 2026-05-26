// 인앱 브라우저 패널.
// 1차 구현: iframe — 호환성 확보 (Linux Tauri 2 multi-webview 미정상)
// 2차: Tauri 2 가 Linux multi-webview 안정화하면 platform 분기로 임베드 webview 전환
//   (issue tauri-apps/tauri#10420, #11376, #10011 참고)
//
// iframe 한계: X-Frame-Options / CSP 로 차단된 외부 사이트는 안 보임 (google 등).
// 잘 됨: localhost / 자체 도메인 / X-Frame 없는 사이트.

import { useEffect, useRef, useState } from 'react';

interface Props {
  panelId: string;
  initialUrl?: string;
}

function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/|$)/.test(t)) return `http://${t}`;
  if (/^\d+\.\d+\.\d+\.\d+/.test(t)) return `http://${t}`;
  if (/\.[a-z]{2,}/i.test(t)) return `https://${t}`;
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
  function reload() { setRefreshKey((k) => k + 1); }
  function back() {
    try { iframeRef.current?.contentWindow?.history.back(); } catch { /* cross-origin */ }
  }
  function forward() {
    try { iframeRef.current?.contentWindow?.history.forward(); } catch { /* cross-origin */ }
  }
  function openExternal() {
    if (!url) return;
    window.open(url, '_blank');
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
          placeholder="URL 또는 검색어 (Enter)"
          spellCheck={false}
        />
        <button className="btn" onClick={() => navigate(draft)}>이동</button>
        {url && (
          <button className="btn btn-ghost browser-nav"
            onClick={openExternal} title="시스템 브라우저에서 열기 (차단 사이트용)">
            ↗
          </button>
        )}
      </div>
      {url ? (
        <iframe
          key={refreshKey}
          ref={iframeRef}
          className="browser-frame"
          src={url}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="browser-empty">
          URL 입력 후 Enter. localhost / 개발 서버 잘 됨.
          <br />외부 사이트 차단 시 ↗ 로 시스템 브라우저에서 열기.
        </div>
      )}
    </div>
  );
}
