// 파일 뷰어/편집 패널 — CodeMirror 기반. 편집 버튼 없이 항상 편집 가능.
//  - .md → 옵시디언식 라이브 프리뷰 (커서 없는 구간은 렌더, 커서 가면 raw)
//  - 코드 → 확장자별 신택스 하이라이트
//  - Ctrl+S 또는 저장 버튼으로 저장 (/fs/write)

import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { livePreview, livePreviewBaseTheme } from '@yuya296/cm6-live-preview-core';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import type { Extension } from '@codemirror/state';
import { readFile, writeFile, type FileContent } from '../api/fs';

/** 확장자 → @uiw/codemirror-extensions-langs 언어 키 */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  html: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'sass', less: 'less',
  sql: 'sql', lua: 'lua',
};

function extOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const m = /\.([a-z0-9]+)$/i.exec(base);
  return m ? m[1].toLowerCase() : '';
}

export function FileViewerPanel({ filePath }: { filePath: string }) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError(null);
    setData(null);
    readFile(filePath)
      .then((d) => { setData(d); setDraft(d.content); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [filePath]);

  const ext = extOf(filePath);
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const dirty = data != null && draft !== data.content;

  const extensions = useMemo<Extension[]>(() => {
    if (isMarkdown) {
      return [markdown(), livePreviewBaseTheme(), livePreview(), EditorView.lineWrapping];
    }
    const key = EXT_LANG[ext];
    const lang = key ? loadLanguage(key as Parameters<typeof loadLanguage>[0]) : null;
    return lang ? [lang] : [];
  }, [isMarkdown, ext]);

  async function save() {
    if (!data || data.truncated || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeFile(filePath, draft);
      setData({ ...data, content: draft });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fileviewer"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          save();
        }
      }}
    >
      {dirty && (
        <div className="fileviewer-bar">
          <span className="fileviewer-dirty">● 저장 안 됨</span>
          <button className="btn" disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '저장 (Ctrl+S)'}
          </button>
        </div>
      )}

      {error && <div className="chat-error">⚠ {error}</div>}
      {data?.truncated && (
        <div className="fileviewer-note">⚠ 256KB 초과 — 일부만 표시 (편집 불가)</div>
      )}

      {data && (
        <div className="fileviewer-body">
          <CodeMirror
            value={draft}
            height="100%"
            extensions={extensions}
            editable={!data.truncated}
            onChange={setDraft}
            basicSetup={{ lineNumbers: !isMarkdown, foldGutter: !isMarkdown }}
          />
        </div>
      )}
    </div>
  );
}
