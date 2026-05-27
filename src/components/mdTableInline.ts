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

/** 표 셀 안 인라인 마크다운 — strikethrough/bold/italic/code/link/image/highlight/sub/sup/checkbox. */
function inlineMd(raw: string): string {
  // 이스케이프 먼저
  let s = escapeHtml(raw);

  // 코드(`) 먼저 — 안의 다른 패턴 변환 회피
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 이미지 ![alt](url) — link 보다 먼저
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, u: string) => {
    const url = u.replace(/"/g, '&quot;');
    return `<img src="${url}" alt="${alt}" />`;
  });

  // 링크 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) => {
    const url = u.replace(/"/g, '&quot;');
    return `<a href="${url}" target="_blank" rel="noreferrer">${t}</a>`;
  });

  // 체크박스 [x] / [ ] — GFM task list 의 셀 안 표현
  s = s.replace(/\[x\]/gi, '<input type="checkbox" checked disabled />');
  s = s.replace(/\[\s\]/g, '<input type="checkbox" disabled />');

  // 취소선 ~~
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 하이라이트 == (GFM 확장)
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  // 강조 (**, __)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

  // 기울임 (*, _)
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  // 위첨자 ^x^
  s = s.replace(/\^([^\s^]+)\^/g, '<sup>$1</sup>');
  // 아래첨자 ~x~ (취소선 ~~ 이후 1개짜리만)
  s = s.replace(/(^|[^~])~([^\s~]+)~(?!~)/g, '$1<sub>$2</sub>');

  return s;
}

/** 1열이 인덱스 컬럼인지 감지 — 헤더가 #/No/번호 또는 빈 값, 셀들이 전부 숫자/짧은 기호 */
function isIndexColumn(widget: Element): boolean {
  const firstHeader = widget.querySelector('th:first-child');
  const headerText = firstHeader?.textContent?.trim() ?? '';
  const headerLooksIndex = headerText === '' || headerText === '#'
    || /^(no|num|번호|순번|idx|index)\.?$/i.test(headerText);
  const cells = widget.querySelectorAll('tbody tr td:first-child');
  if (cells.length === 0) return false;
  let allNumeric = true;
  cells.forEach((c) => {
    const t = c.textContent?.trim() ?? '';
    // 빈 값, 순수 숫자, 또는 길이 3 이하 짧은 기호 (예: ✓, ★) 허용
    if (!(t === '' || /^[0-9]+$/.test(t) || t.length <= 2)) allNumeric = false;
  });
  return headerLooksIndex && allNumeric;
}

function patch(root: Element): void {
  // 위젯 단위 — 인덱스 컬럼 클래스 부여 + 셀별 인라인 파싱
  const widgets = root.querySelectorAll<HTMLElement>('.cm-table-widget:not([data-md-cols])');
  widgets.forEach((w) => {
    if (isIndexColumn(w)) w.classList.add('first-col-index');
    w.setAttribute('data-md-cols', '');
  });

  const cells = root.querySelectorAll<HTMLElement>(
    '.cm-table-widget td:not([data-md-parsed]), .cm-table-widget th:not([data-md-parsed])',
  );
  cells.forEach((el) => {
    const text = el.textContent ?? '';
    // 인라인 마크다운 문법 흔적이 있을 때만 파싱 (불필요 innerHTML 절약)
    if (/[*_`~=^[!]/.test(text)) {
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
