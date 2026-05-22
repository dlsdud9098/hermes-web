// 한 패널 = 한 Hermes 세션 채팅. dockview 패널 component 로 등록됨.

import { useEffect, useRef, useState } from 'react';
import { streamChat, HermesApiError } from '../api/hermes';
import { useProjects } from '../store/projects';
import type { ChatMessage } from '../types';

interface ChatPanelProps {
  panelId: string;
  projectId: string;
}

export function ChatPanel({ panelId, projectId }: ChatPanelProps) {
  const { messages: store, setMessages, projects } = useProjects();
  const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
  const [messages, setLocal] = useState<ChatMessage[]>(() => store[panelId] ?? []);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 로컬 상태 → store 동기화 (패널 remount 시에도 히스토리 유지)
  useEffect(() => { setMessages(panelId, messages); }, [messages, panelId, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    setError(null);
    setDraft('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setLocal([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let acc = '';
      // 세션 id = panelId. Hermes 가 히스토리를 유지하므로 새 메시지만 전송
      for await (const delta of streamChat({
        sessionId: panelId,
        projectId,
        projectPath,
        message: text,
        signal: ac.signal,
      })) {
        acc += delta;
        setLocal([...history, { role: 'assistant', content: acc }]);
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // 사용자 중단 — 현재까지 받은 내용 유지
      } else {
        const msg = err instanceof HermesApiError ? err.message
          : err instanceof Error ? err.message : String(err);
        setError(msg);
        setLocal(history); // 빈 assistant 자리 제거
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">메시지를 입력해 세션 시작</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <span className="msg-role">{m.role}</span>
            <div className="msg-body">{m.content || (streaming ? '…' : '')}</div>
          </div>
        ))}
        {error && <div className="chat-error">⚠ {error}</div>}
      </div>
      <div className="chat-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="메시지… (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
        />
        {streaming
          ? <button className="btn btn-stop" onClick={stop}>중단</button>
          : <button className="btn" onClick={send} disabled={!draft.trim()}>전송</button>}
      </div>
    </div>
  );
}
