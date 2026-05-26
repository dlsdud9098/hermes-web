// 인앱 브라우저 패널 — Tauri 자식 webview 임베드.
// 패널 div bbox 를 측정해 Rust 에 전달, webview 가 그 위치/크기로 떠 있음.
// 진짜 Chromium/WebKit 이라 X-Frame-Options 제약 없음. 로그인/JS 모두 동작.
//
// 브라우저 환경(Tauri 아님) 에서는 invoke 가 no-op → 빈 패널.

import { useEffect, useRef, useState } from 'react';
import {
  browserCreate, browserNavigate, browserSetBounds, browserSetVisible, browserClose,
} from '../api/browser';
import { isTauri } from '../runtime';

interface Props {
  panelId: string;
  initialUrl?: string;
}

function normalizeForDraft(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^[a-z]+:\/\//i.test(t)) return t;
  if (/^localhost/i.test(t)) return `http://${t}`;
  if (/\.[a-z]{2,}/i.test(t)) return `https://${t}`;
  return t;
}

export function BrowserPanel({ panelId, initialUrl = '' }: Props) {
  const [draft, setDraft] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const slotRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(true);

  // bbox 측정 — div 의 윈도우 기준 좌표 (CSS px)
  const measure = () => {
    const el = slotRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  // 마운트 — 자식 webview 생성. bbox 측정 후 호출.
  useEffect(() => {
    if (!isTauri) return;
    const b = measure() ?? { x: 0, y: 0, w: 100, h: 100 };
    void browserCreate(panelId, url || 'about:blank', b);
    return () => { void browserClose(panelId); };
  }, [panelId]); // url 은 별도 effect 로 navigate

  // URL 변경 — navigate
  useEffect(() => {
    if (!isTauri || !url) return;
    void browserNavigate(panelId, url);
  }, [url, panelId]);

  // 크기/위치 변화 — ResizeObserver + scroll/window resize 동시 감시
  useEffect(() => {
    if (!isTauri) return;
    let raf: number | null = null;
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!visibleRef.current) return;
        const b = measure();
        if (b) void browserSetBounds(panelId, b);
      });
    };
    const el = slotRef.current;
    const ro = el ? new ResizeObserver(sync) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    // dockview 패널 드래그/리사이즈 — 빈번 — 100ms 폴링 백업
    const handle = window.setInterval(sync, 200);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      window.clearInterval(handle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [panelId]);

  // 패널이 화면에서 사라질 때 webview 숨김 (탭 전환/dockview 그룹 비활성)
  useEffect(() => {
    if (!isTauri) return;
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const isIntersecting = entries[0]?.isIntersecting ?? true;
      visibleRef.current = isIntersecting;
      void browserSetVisible(panelId, isIntersecting);
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [panelId]);

  function navigate(to: string) {
    const u = normalizeForDraft(to);
    if (u) setUrl(u);
  }

  return (
    <div className="browser">
      <div className="browser-bar">
        <button className="btn btn-ghost browser-nav"
          onClick={() => void browserNavigate(panelId, 'javascript:history.back()')}
          title="뒤로">◀</button>
        <button className="btn btn-ghost browser-nav"
          onClick={() => void browserNavigate(panelId, 'javascript:history.forward()')}
          title="앞으로">▶</button>
        <button className="btn btn-ghost browser-nav"
          onClick={() => url && void browserNavigate(panelId, url)}
          title="새로고침">⟳</button>
        <input
          className="browser-url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); navigate(draft); }
          }}
          placeholder="URL 입력 후 Enter"
          spellCheck={false}
        />
        <button className="btn" onClick={() => navigate(draft)}>이동</button>
      </div>
      {/* 자식 webview 가 이 영역 위에 오버레이됨 — 빈 배경만 유지 */}
      <div ref={slotRef} className="browser-slot">
        {!isTauri && (
          <div className="browser-empty">
            임베드 브라우저는 Tauri 데스크톱 모드에서만 동작 (브라우저 dev 모드 아님)
          </div>
        )}
      </div>
    </div>
  );
}
