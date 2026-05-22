// 파일 내용을 읽기 전용으로 보여주는 dockview 패널 (신택스 하이라이트).

import { useEffect, useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { readFile, type FileContent } from '../api/fs';

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

  const html = useMemo(() => {
    if (!data) return null;
    try {
      return hljs.highlightAuto(data.content).value;
    } catch {
      return null;
    }
  }, [data]);

  return (
    <div className="fileviewer">
      {error && <div className="chat-error">⚠ {error}</div>}
      {data && (
        <>
          {data.truncated && (
            <div className="fileviewer-note">⚠ 256KB 초과 — 일부만 표시</div>
          )}
          <pre className="fileviewer-pre">
            {html
              ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
              : <code className="hljs">{data.content}</code>}
          </pre>
        </>
      )}
    </div>
  );
}
