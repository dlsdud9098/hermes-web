// HTML/SVG 라이브 프리뷰 패널 — sandboxed iframe srcdoc 으로 격리 렌더.
// FileViewer 의 draft 가 previewBus 로 전달되면 즉시 반영. 없으면 디스크에서 읽음.

import { useEffect, useMemo, useState } from 'react';
import { readFile } from '../api/fs';
import { getDraft, subscribeDraft } from '../previewBus';

interface Props {
  filePath: string;
}

export function HtmlPreviewPanel({ filePath }: Props) {
  const [content, setContent] = useState<string>(() => getDraft(filePath) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 라이브 구독 — FileViewer 가 같은 path 로 publishDraft 하면 즉시 반영
  useEffect(() => subscribeDraft(filePath, setContent), [filePath]);

  // 최초 진입 시 draft 가 비어있으면 디스크에서 한 번 읽는다
  useEffect(() => {
    if (getDraft(filePath) != null) return;
    setLoading(true);
    setError(null);
    readFile(filePath)
      .then((d) => setContent(d.content))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [filePath]);

  const ext = useMemo(() => {
    const m = /\.([a-z0-9]+)$/i.exec(filePath);
    return m ? m[1].toLowerCase() : '';
  }, [filePath]);

  // SVG 는 본문 그대로 iframe 에 srcdoc 으로 넣어도 렌더되지만, HTML 문서로 래핑해 가운데 정렬.
  const srcDoc = useMemo(() => {
    if (ext === 'svg') {
      return `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${content}</body></html>`;
    }
    return content;
  }, [ext, content]);

  return (
    <div className="htmlpreview">
      {error && <div className="chat-error">⚠ {error}</div>}
      {loading && <div className="fileviewer-note">로딩…</div>}
      <iframe
        className="htmlpreview-frame"
        title={`preview: ${filePath}`}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        srcDoc={srcDoc}
      />
    </div>
  );
}
