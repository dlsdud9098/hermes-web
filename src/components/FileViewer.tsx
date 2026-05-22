// 파일 내용 읽기 전용 뷰어 패널.
//  - .md/.markdown → 마크다운 렌더링 (옵시디언 느낌)
//  - 코드 파일 → 확장자 기반 신택스 하이라이트 (VS Code 느낌)

import { useEffect, useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { readFile, type FileContent } from '../api/fs';
import { Markdown } from './Markdown';

/** 확장자 → highlight.js 언어 id */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
  html: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', dockerfile: 'dockerfile', lua: 'lua', r: 'r',
};

function extOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
  const m = /\.([a-z0-9]+)$/i.exec(base);
  return m ? m[1].toLowerCase() : '';
}

export function FileViewerPanel({ filePath }: { filePath: string }) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setData(null);
    readFile(filePath)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [filePath]);

  const ext = extOf(filePath);
  const isMarkdown = ext === 'md' || ext === 'markdown';

  const html = useMemo(() => {
    if (!data || isMarkdown) return null;
    try {
      const lang = EXT_LANG[ext];
      return lang && hljs.getLanguage(lang)
        ? hljs.highlight(data.content, { language: lang }).value
        : hljs.highlightAuto(data.content).value;
    } catch {
      return null;
    }
  }, [data, ext, isMarkdown]);

  return (
    <div className="fileviewer">
      {error && <div className="chat-error">⚠ {error}</div>}
      {data && (
        <>
          {data.truncated && (
            <div className="fileviewer-note">⚠ 256KB 초과 — 일부만 표시</div>
          )}
          {isMarkdown ? (
            <div className="fileviewer-md">
              <Markdown content={data.content} />
            </div>
          ) : (
            <pre className="fileviewer-pre">
              {html
                ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
                : <code className="hljs">{data.content}</code>}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
