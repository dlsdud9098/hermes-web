// 파일 뷰어/편집 패널 — CodeMirror 기반. 편집 버튼 없이 항상 편집 가능.
//  - .md → codemirror-live-markdown 으로 옵시디언식 라이브 프리뷰(헤더·볼드 등 렌더)
//  - 코드 → 확장자별 신택스 하이라이트
//  - 줄번호·줄바꿈·탭크기·자동저장·테마·코드글씨 설정(useSettings) 반영

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import {
  livePreviewPlugin, markdownStylePlugin, editorTheme,
  mouseSelectingField, collapseOnSelectionFacet,
} from 'codemirror-live-markdown';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import { readFile, writeFile, type FileContent } from '../api/fs';
import { useSettings } from '../store/settings';

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
  const { settings } = useSettings();
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);

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
    const list: Extension[] = [
      EditorState.tabSize.of(settings.tabSize),
      indentUnit.of(' '.repeat(settings.tabSize)),
      EditorView.theme({ '&': { fontSize: `${settings.codeFontSize}px` } }),
    ];
    if (settings.wordWrap || isMarkdown) list.push(EditorView.lineWrapping);
    if (isMarkdown) {
      list.push(markdown());
      if (settings.mdLivePreview) {
        list.push(
          collapseOnSelectionFacet.of(true),
          mouseSelectingField,
          livePreviewPlugin,
          markdownStylePlugin,
          editorTheme,
        );
      }
    } else {
      const key = EXT_LANG[ext];
      const lang = key ? loadLanguage(key as Parameters<typeof loadLanguage>[0]) : null;
      if (lang) list.push(lang);
    }
    return list;
  }, [isMarkdown, ext, settings.mdLivePreview, settings.wordWrap,
      settings.tabSize, settings.codeFontSize]);

  const save = useCallback(async () => {
    if (!data || data.truncated || draft === data.content || saving) return;
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
  }, [data, draft, saving, filePath]);

  // 자동 저장 — 편집 후 1초 디바운스
  useEffect(() => {
    if (!settings.autoSave || !dirty) return;
    saveTimer.current = window.setTimeout(() => { void save(); }, 1000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [draft, settings.autoSave, dirty, save]);

  return (
    <div
      className="fileviewer"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      {dirty && (
        <div className="fileviewer-bar">
          <span className="fileviewer-dirty">● 저장 안 됨</span>
          <button className="btn" disabled={saving} onClick={() => void save()}>
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
            theme={settings.theme === 'dark' ? 'dark' : 'light'}
            extensions={extensions}
            editable={!data.truncated}
            onChange={setDraft}
            basicSetup={{
              lineNumbers: settings.lineNumbers,
              foldGutter: settings.lineNumbers,
            }}
          />
        </div>
      )}
    </div>
  );
}
