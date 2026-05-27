// 파일 뷰어/편집 패널 — CodeMirror 기반. 편집 버튼 없이 항상 편집 가능.
//  - .md → codemirror-live-markdown 으로 옵시디언식 라이브 프리뷰(헤더·볼드 등 렌더)
//  - 코드 → 확장자별 신택스 하이라이트
//  - 줄번호·줄바꿈·탭크기·자동저장·테마·코드글씨 설정(useSettings) 반영

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import {
  livePreviewPlugin, markdownStylePlugin, editorTheme,
  mouseSelectingField, collapseOnSelectionFacet,
  codeBlockField, tableField, initHighlighter,
  setMouseSelecting,
} from 'codemirror-live-markdown';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import { readFile, writeFile, type FileContent } from '../api/fs';
import { useSettings } from '../store/settings';
import { taskCheckboxes } from './mdCheckbox';
import { mdTableInline } from './mdTableInline';
import { publishDraft } from '../previewBus';

// 코드블록 신택스 하이라이터 1회 초기화 (lowlight)
void initHighlighter();

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
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    setError(null);
    setData(null);
    readFile(filePath)
      .then((d) => { setData(d); setDraft(d.content); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [filePath]);

  // 초기 렌더 트리거 — codemirror-live-markdown 의 mouseSelectingField 가
  // 가끔 첫 mount 시 잘못된 상태에 있어 클릭 전까지 source 모드로 표시됨.
  // 콘텐츠 로드된 직후 setMouseSelecting(false) 디스패치 → 디코레이션 재평가.
  useEffect(() => {
    if (!data || !isMarkdown || !settings.mdLivePreview) return;
    const view = viewRef.current;
    if (!view) return;
    // 다음 프레임에 dispatch — 에디터가 새 content 처리 후 안전하게
    const id = requestAnimationFrame(() => {
      view.dispatch({ effects: setMouseSelecting.of(false) });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // VSCode 식 자동 따라가기 — 파일 변화 항상 감지.
  // 사용자가 스크롤을 끝에 두면 새 내용을 받아서 끝으로 따라감.
  // 위로 스크롤해 보고 있으면 위치 유지 (자동 점프 안 함).
  useEffect(() => {
    let cancelled = false;
    const SCROLL_BOTTOM_THRESHOLD = 8;
    const tick = async () => {
      if (cancelled) return;
      try {
        const fresh = await readFile(filePath);
        if (cancelled || !data) return;
        if (fresh.content === data.content) return;
        // 사용자가 dirty 면(편집 중) 디스크 변화 덮어쓰지 않음
        if (draft !== data.content) {
          setData(fresh);
          return;
        }
        const view = viewRef.current;
        if (!view) {
          setData(fresh);
          setDraft(fresh.content);
          return;
        }
        const sc = view.scrollDOM;
        const savedTop = sc.scrollTop;
        const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
        // 직접 dispatch — selection 유지, scrollIntoView=false.
        // @uiw/react-codemirror 가 value prop 변경 감지해 또 dispatch 하는 걸 피하려고
        // doc 을 먼저 새 content 와 일치시킨다.
        const docLen = view.state.doc.length;
        // selection 이 새 doc 길이 초과면 끝으로 클램프
        const selFrom = Math.min(view.state.selection.main.from, fresh.content.length);
        const selTo = Math.min(view.state.selection.main.to, fresh.content.length);
        view.dispatch({
          changes: { from: 0, to: docLen, insert: fresh.content },
          selection: { anchor: selFrom, head: selTo },
          scrollIntoView: false,
        });
        setData(fresh);
        setDraft(fresh.content);
        // 스크롤 위치 강제 보존 (CodeMirror 가 layout 후 재계산해도 덮어씀)
        if (atBottom) {
          requestAnimationFrame(() => {
            const v = viewRef.current;
            if (!v) return;
            v.dispatch({
              selection: { anchor: v.state.doc.length },
              scrollIntoView: true,
            });
          });
        } else {
          sc.scrollTop = savedTop;
          // 다음 두 프레임에 걸쳐 한 번 더 복원 — layout 시점 차이 보정
          requestAnimationFrame(() => { sc.scrollTop = savedTop; });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => { sc.scrollTop = savedTop; }),
          );
        }
      } catch {
        // 파일 회전/일시 사라짐 등 — 다음 tick 에 재시도
      }
    };
    const handle = window.setInterval(() => { void tick(); }, 1500);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [filePath, data, draft]);

  const ext = extOf(filePath);
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const isPreviewable = ext === 'html' || ext === 'htm' || ext === 'svg';
  const dirty = data != null && draft !== data.content;

  // draft → 프리뷰 라이브 동기화
  useEffect(() => {
    if (isPreviewable) publishDraft(filePath, draft);
  }, [isPreviewable, filePath, draft]);

  function openPreview() {
    window.dispatchEvent(new CustomEvent('hermes:open-preview', {
      detail: { filePath },
    }));
  }

  const extensions = useMemo<Extension[]>(() => {
    const list: Extension[] = [
      EditorState.tabSize.of(settings.tabSize),
      indentUnit.of(' '.repeat(settings.tabSize)),
      EditorView.theme({ '&': { fontSize: `${settings.codeFontSize}px` } }),
      search({ top: true }),
      keymap.of(searchKeymap),
    ];
    if (settings.wordWrap || isMarkdown) list.push(EditorView.lineWrapping);
    if (isMarkdown) {
      list.push(markdown({ extensions: [GFM] }));
      if (settings.mdLivePreview) {
        list.push(
          collapseOnSelectionFacet.of(true),
          mouseSelectingField,
          livePreviewPlugin,
          markdownStylePlugin,
          codeBlockField({ copyButton: true }),
          tableField,
          mdTableInline,
          taskCheckboxes,
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
          return;
        }
        // CodeMirror 에디터 안에 포커스가 있을 때 Ctrl+F/Ctrl+H 가로채서
        // 전역 검색이 아닌 파일 내 검색 패널을 연다.
        const target = e.target as HTMLElement | null;
        const inEditor = !!target?.closest('.cm-editor');
        if (inEditor && (e.ctrlKey || e.metaKey) && !e.altKey) {
          const key = e.key.toLowerCase();
          if (key === 'f' || key === 'h') {
            const view = viewRef.current;
            if (view) {
              e.preventDefault();
              e.stopPropagation();
              openSearchPanel(view);
            }
          }
        }
      }}
    >
      {(dirty || isPreviewable) && (
        <div className="fileviewer-bar">
          {dirty && <span className="fileviewer-dirty">● 저장 안 됨</span>}
          {isPreviewable && (
            <button className="btn btn-ghost" onClick={openPreview} title="Ctrl+P">
              👁 프리뷰
            </button>
          )}
          {dirty && (
            <button className="btn" disabled={saving} onClick={() => void save()}>
              {saving ? '저장 중…' : '저장 (Ctrl+S)'}
            </button>
          )}
        </div>
      )}

      {error && <div className="chat-error">⚠ {error}</div>}
      {data?.truncated && (
        <div className="fileviewer-note">⚠ 256KB 초과 — 일부만 표시 (편집 불가)</div>
      )}

      {data && (
        <div className="fileviewer-body">
          <CodeMirror
            className="fv-cm"
            value={draft}
            height="100%"
            theme={settings.theme === 'dark' ? 'dark' : 'light'}
            extensions={extensions}
            editable={!data.truncated}
            onChange={setDraft}
            onCreateEditor={(view) => { viewRef.current = view; }}
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
