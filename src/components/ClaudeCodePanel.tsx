// Claude Code 인터랙티브 PTY 패널.
// Hermes ChatPanel 과 거의 동일한 UX 지만 백엔드가 PTY 안의 진짜 claude TUI.
// 턴 완료 이벤트(`claude:turn`)가 도착하면 assistant 메시지를 추가한다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { claudeStart, claudeSend, claudeStop, onClaudeTurn } from '../api/claudeCli';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import type { ChatMessage } from '../types';
import type { UnlistenFn } from '@tauri-apps/api/event';

interface Props {
  panelId: string;
  projectId: string;
}

export function ClaudeCodePanel({ panelId, projectId }: Props) {
  const { messages: store, setMessages, projects } = useProjects();
  const { settings } = useSettings();
  const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
  const [messages, setLocal] = useState<ChatMessage[]>(() => store[panelId] ?? []);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages(panelId, messages); }, [messages, panelId, setMessages]);

  useEffect(() => {
    if (settings.autoScroll) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, settings.autoScroll]);

  // 턴 완료 이벤트 구독 — 본 패널 것만 처리
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    onClaudeTurn((ev) => {
      if (ev.panel_id !== panelId) return;
      const tools = ev.tools.map((name) => ({
        tool: name, preview: '', status: 'done' as const,
      }));
      setLocal((prev) => [
        ...prev,
        { role: 'assistant', content: ev.text, tools },
      ]);
      setStreaming(false);
    }).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, [panelId]);

  // 패널 닫힐 때 PTY 정리
  useEffect(() => () => { void claudeStop(panelId); }, [panelId]);

  const start = useCallback(async () => {
    if (!projectPath) {
      setError('프로젝트 경로 없음');
      return;
    }
    try {
      await claudeStart(panelId, projectPath);
      setStarted(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [panelId, projectPath]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    if (!started) {
      await start();
      if (error) return;
    }
    setDraft('');
    setError(null);
    setLocal((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming(true);
    try {
      await claudeSend(panelId, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      const shouldSend = settings.enterToSend ? !e.shiftKey : e.shiftKey;
      if (shouldSend) {
        e.preventDefault();
        void send();
      }
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Claude Code 인터랙티브 세션 — 메시지 입력하면 PTY 안에서 진짜 claude TUI 가 뜬다.
            <br />첫 사용 전 터미널에서 `claude` 한 번 실행해 로그인 + 초기 다이얼로그 처리 필요.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <span className="msg-role">{m.role}</span>
            <div className="msg-body">
              {m.role === 'assistant' ? (
                <>
                  {m.tools?.map((t, ti) => <ToolCard key={ti} tool={t} />)}
                  {m.content
                    ? <Markdown content={m.content} />
                    : (streaming ? '…' : null)}
                </>
              ) : m.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="msg msg-assistant">
            <span className="msg-role">assistant</span>
            <div className="msg-body">…진행 중 (턴 완료 시 한 번에 도착)</div>
          </div>
        )}
        {error && <div className="chat-error">⚠ {error}</div>}
      </div>
      <div className="chat-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Claude Code 메시지… (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
        />
        {streaming
          ? <button className="btn btn-stop" disabled>대기 중…</button>
          : <button className="btn" onClick={() => void send()} disabled={!draft.trim()}>전송</button>}
      </div>
    </div>
  );
}
