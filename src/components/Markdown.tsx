// 에이전트 응답 마크다운 렌더링 — GFM(표/체크박스) + 코드 신택스 하이라이트 + 복사.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    try {
      return lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [code, lang]);

  function copy() {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => { /* 클립보드 차단 — 무시 */ });
  }

  return (
    <div className="code-block">
      <div className="code-bar">
        <span className="code-lang">{lang ?? 'text'}</span>
        <button className="code-copy" onClick={copy}>{copied ? '복사됨' : '복사'}</button>
      </div>
      <pre>
        {html
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code className="hljs">{code}</code>}
      </pre>
    </div>
  );
}

const components: Components = {
  // react-markdown 의 <pre> 래퍼 제거 — CodeBlock 이 자체 <pre> 를 가진다
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const text = String(children ?? '');
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    const isBlock = Boolean(lang) || text.includes('\n');
    return isBlock
      ? <CodeBlock code={text.replace(/\n$/, '')} lang={lang} />
      : <code className="inline-code">{children}</code>;
  },
  // 이미지 — 클릭 시 새 탭/창에 원본 크기로 열기
  img: ({ src, alt }) => (
    <img
      className="md-image"
      src={typeof src === 'string' ? src : ''}
      alt={alt ?? ''}
      loading="lazy"
      onClick={() => { if (typeof src === 'string') window.open(src, '_blank'); }}
    />
  ),
};

export function Markdown({ content }: { content: string }): ReactNode {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
