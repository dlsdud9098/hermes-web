// 파일 뷰어/편집 패널.
//  - 보기: .md → 마크다운 렌더 / 코드 → 신택스 하이라이트
//  - 편집: 텍스트area 로 수정 후 저장 (/fs/write)

import { useEffect, useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { readFile, writeFile, type FileContent } from '../api/fs';
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError(null);
    setData(null);
    setEditing(false);
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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await writeFile(filePath, draft);
      setData((prev) => (prev ? { ...prev, content: draft } : prev));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fileviewer">
      <div className="fileviewer-bar">
        {editing ? (
          <>
            <button className="btn" disabled={saving} onClick={save}>
              {saving ? '저장 중…' : '저장'}
            </button>
            <button className="btn btn-ghost" disabled={saving} onClick={() => setEditing(false)}>
              취소
            </button>
          </>
        ) : (
          data && !data.truncated && (
            <button
              className="btn btn-ghost"
              onClick={() => { setDraft(data.content); setEditing(true); }}
            >
              편집
            </button>
          )
        )}
      </div>

      {error && <div className="chat-error">⚠ {error}</div>}
      {data?.truncated && (
        <div className="fileviewer-note">⚠ 256KB 초과 — 일부만 표시 (편집 불가)</div>
      )}

      {data && (
        editing ? (
          <textarea
            className="fileviewer-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
        ) : isMarkdown ? (
          <div className="fileviewer-body fileviewer-md">
            <Markdown content={data.content} />
          </div>
        ) : (
          <pre className="fileviewer-body fileviewer-pre">
            {html
              ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
              : <code className="hljs">{data.content}</code>}
          </pre>
        )
      )}
    </div>
  );
}
