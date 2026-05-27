// codemirror-live-markdown 의 tableField 가 셀을 textContent 로만 렌더해서
// **bold** / *italic* / `code` / [link](url) 등 인라인 마크다운이 raw 로 보임.
// MutationObserver 로 .cm-table-widget 안 td/th 를 패치해 인라인 파싱 결과 주입.

import { ViewPlugin } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 작은 인라인 마크다운 파서 — bold/italic/code/link 만. */
function inlineMd(raw: string): string {
  // 이스케이프 먼저 (모든 HTML special) → 그 뒤 패턴 치환
  let s = escapeHtml(raw);
  // code 먼저 (내부 다른 패턴 치환 회피)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // strong (**, __)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  // emphasis (*, _)
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  // link
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) => {
    const url = u.replace(/"/g, '&quot;');
    return `<a href="${url}" target="_blank" rel="noreferrer">${t}</a>`;
  });
  return s;
}

function patch(root: Element): void {
  const cells = root.querySelectorAll<HTMLElement>(
    '.cm-table-widget td:not([data-md-parsed]), .cm-table-widget th:not([data-md-parsed])',
  );
  cells.forEach((el) => {
    const text = el.textContent ?? '';
    if (text.includes('**') || text.includes('*') || text.includes('`')
        || text.includes('_') || text.includes('[')) {
      el.innerHTML = inlineMd(text);
    }
    el.setAttribute('data-md-parsed', '');
  });
}

export const mdTableInline = ViewPlugin.fromClass(class {
  observer: MutationObserver;
  constructor(view: EditorView) {
    patch(view.dom);
    this.observer = new MutationObserver(() => patch(view.dom));
    this.observer.observe(view.dom, { childList: true, subtree: true });
  }
  destroy(): void { this.observer.disconnect(); }
});
