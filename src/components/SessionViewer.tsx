// 외부 코딩 에이전트 세션의 읽기 전용 뷰어. dockview 패널로 열린다.
// JSONL 을 invoke('session_load') 로 정규화된 메시지 배열로 받아 렌더.

import { useEffect, useState } from 'react';
import { loadSession, type SessionMsg } from '../api/sessions';
import { Markdown } from './Markdown';

interface Props {
  source: 'claude' | 'codex';
  file: string;
}

export function SessionViewerPanel({ source, file }: Props) {
  const [msgs, setMsgs] = useState<SessionMsg[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMsgs(null);
    setError(null);
    loadSession(source, file)
      .then(setMsgs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [source, file]);

  return (
    <div className="chat sessionviewer">
      <div className="chat-log">
        {error && <div className="chat-error">⚠ {error}</div>}
        {!msgs && !error && <div className="chat-empty">로딩…</div>}
        {msgs && msgs.length === 0 && <div className="chat-empty">메시지 없음</div>}
        {msgs?.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <span className="msg-role">{m.role}</span>
            <div className="msg-body">
              {m.role === 'assistant'
                ? <Markdown content={m.text} />
                : m.text}
            </div>
            {m.timestamp && (
              <div className="msg-meta">
                <span>{new Date(m.timestamp).toLocaleString()}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
