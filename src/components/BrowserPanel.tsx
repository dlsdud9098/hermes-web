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

/** 메인창 inner position + scale factor 캐시 — 매 sync 마다 Tauri IPC 안 하도록.
 *  onMoved/onResized 이벤트 시 무효화 → 다음 호출에 갱신. */
let cachedWinPos: { ix: number; iy: number; scale: number } | null = null;
function invalidateWinPos(): void { cachedWinPos = null; }

async function getWinPos(): Promise<{ ix: number; iy: number; scale: number } | null> {
  if (cachedWinPos) return cachedWinPos;
  if (!isTauri) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const inner = await win.innerPosition();
    const scale = await win.scaleFactor();
    cachedWinPos = { ix: inner.x / scale, iy: inner.y / scale, scale };
    return cachedWinPos;
  } catch {
    return null;
  }
}

/** 슬롯 div 의 화면 절대 좌표(logical px). 동기 — 캐시된 winPos 사용. */
function computeBoundsSync(slot: HTMLElement, winPos: { ix: number; iy: number }): ScreenBounds | null {
  const r = slot.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  return { x: winPos.ix + r.left, y: winPos.iy + r.top, w: r.width, h: r.height };
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
      const wp = await getWinPos();
      const b = wp ? (computeBoundsSync(slot, wp) ?? { x: 200, y: 200, w: 800, h: 600 })
                   : { x: 200, y: 200, w: 800, h: 600 };
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

  // 위치/크기 동기화 — 이벤트 기반 + 저빈도 폴링 백업
  useEffect(() => {
    if (!isTauri) return;
    let raf: number | null = null;
    let lastJson = '';
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(async () => {
        raf = null;
        if (!visibleRef.current || !createdRef.current) return;
        const slot = slotRef.current;
        if (!slot) return;
        const wp = await getWinPos();        // 캐시 — 첫 호출만 IPC
        if (!wp) return;
        const b = computeBoundsSync(slot, wp);
        if (!b) return;
        const json = `${b.x.toFixed(0)},${b.y.toFixed(0)},${b.w.toFixed(0)},${b.h.toFixed(0)}`;
        if (json === lastJson) return;
        lastJson = json;
        void browserSetBounds(panelId, b);
      });
    };

    const el = slotRef.current;
    const ro = el ? new ResizeObserver(sync) : null;
    if (el && ro) ro.observe(el);

    const onResize = () => { invalidateWinPos(); sync(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    // 메인창 move/resize 이벤트 구독 — 캐시 무효화 + 동기화
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      unlistenMove = await win.onMoved(() => { invalidateWinPos(); sync(); });
      unlistenResize = await win.onResized(() => { invalidateWinPos(); sync(); });
    })();

    // 폴링 백업 — dockview 드래그처럼 ResizeObserver 만으론 잡기 어려운 케이스.
    // 캐시 덕에 IPC 부담 적음 (winPos 변화 없을 때 sync 는 거의 no-op).
    const handle = window.setInterval(sync, 500);

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
