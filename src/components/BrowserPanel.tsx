// 인앱 브라우저 패널 — 별도 borderless WebviewWindow 가 슬롯 위에 겹쳐 떠 있는 방식.
// Linux Tauri multi-webview 깨진 문제(tauri#10420 등) 우회.
// 진짜 Chromium/WebKit 으로 X-Frame-Options 등 모든 사이트 정상 로드.

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

interface ScreenBounds { x: number; y: number; w: number; h: number }

/** 슬롯 div 의 화면 절대 좌표(logical px) 계산 — 메인창 inner pos + getBoundingClientRect */
async function computeBounds(slot: HTMLElement): Promise<ScreenBounds | null> {
  if (!isTauri) return null;
  const r = slot.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const inner = await win.innerPosition();   // physical px
    const scale = await win.scaleFactor();
    const ix = inner.x / scale;
    const iy = inner.y / scale;
    return { x: ix + r.left, y: iy + r.top, w: r.width, h: r.height };
  } catch {
    return null;
  }
}

export function BrowserPanel({ panelId, initialUrl = '' }: Props) {
  const [draft, setDraft] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const slotRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(true);
  const createdRef = useRef(false);

  useEffect(() => { setDraft(url); }, [url]);

  // 마운트 — 자식 창 생성 (다음 프레임에 측정해 정확한 위치)
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    const tid = window.setTimeout(async () => {
      const slot = slotRef.current;
      if (!slot || cancelled) return;
      const b = (await computeBounds(slot)) ?? { x: 200, y: 200, w: 800, h: 600 };
      try {
        await browserCreate(panelId, url || 'https://duckduckgo.com', b);
        createdRef.current = true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[BrowserPanel] create 실패', e);
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
      if (createdRef.current) void browserClose(panelId);
    };
  }, [panelId]);

  // URL 변경 → 자식 창 navigate
  useEffect(() => {
    if (!isTauri || !url || !createdRef.current) return;
    void browserNavigate(panelId, url);
  }, [url, panelId]);

  // 위치/크기 동기화 — ResizeObserver + 메인창 이동/리사이즈 + 100ms 폴링
  useEffect(() => {
    if (!isTauri) return;
    let raf: number | null = null;
    let lastJson = '';
    const sync = async () => {
      if (raf) return;
      raf = requestAnimationFrame(async () => {
        raf = null;
        if (!visibleRef.current || !createdRef.current) return;
        const slot = slotRef.current;
        if (!slot) return;
        const b = await computeBounds(slot);
        if (!b) return;
        const json = `${b.x.toFixed(0)},${b.y.toFixed(0)},${b.w.toFixed(0)},${b.h.toFixed(0)}`;
        if (json === lastJson) return;
        lastJson = json;
        void browserSetBounds(panelId, b);
      });
    };

    const el = slotRef.current;
    const ro = el ? new ResizeObserver(() => { void sync(); }) : null;
    if (el && ro) ro.observe(el);

    const onResize = () => { void sync(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    // 메인창 move/resize 이벤트 구독
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      unlistenMove = await win.onMoved(() => { void sync(); });
      unlistenResize = await win.onResized(() => { void sync(); });
    })();

    // 폴링 백업 — dockview 드래그 등 native event 안 잡힐 때
    const handle = window.setInterval(() => { void sync(); }, 150);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearInterval(handle);
      if (raf) cancelAnimationFrame(raf);
      if (unlistenMove) unlistenMove();
      if (unlistenResize) unlistenResize();
    };
  }, [panelId]);

  // 화면 가시성 — 패널이 hidden 되면 자식 창 hide
  useEffect(() => {
    if (!isTauri) return;
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const vis = entries[0]?.isIntersecting ?? true;
      visibleRef.current = vis;
      if (createdRef.current) void browserSetVisible(panelId, vis);
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
          onClick={() => void browserNavigate(panelId, 'javascript:history.back();void(0)')}
          title="뒤로">◀</button>
        <button className="btn btn-ghost browser-nav"
          onClick={() => void browserNavigate(panelId, 'javascript:history.forward();void(0)')}
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
      <div ref={slotRef} className="browser-slot">
        {!isTauri && (
          <div className="browser-empty">
            인앱 브라우저는 Tauri 데스크톱 모드에서만 동작 (브라우저 dev 모드 아님)
          </div>
        )}
      </div>
    </div>
  );
}
