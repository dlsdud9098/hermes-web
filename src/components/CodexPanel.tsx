// Codex CLI 인터랙티브 패널 — codex exec --json 매 턴 spawn.
// 첫 턴에 thread.started 의 thread_id 캡쳐 → 이후 턴은 자동 resume.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codexSend, codexClearSession, codexCheck, codexLoginStatus,
  onCodexDelta, onCodexToolStart, onCodexToolEnd, onCodexTurnEnd, onCodexError,
} from '../api/codexCli';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { CopyButton } from './CopyButton';
import type { ChatMessage, ToolCall } from '../types';
import type { UnlistenFn } from '@tauri-apps/api/event';

interface Props { panelId: string; projectId: string }

function completeTool(tools: ToolCall[], id: string, error: boolean): ToolCall[] {
  return tools.map((t) => (t.id === id ? { ...t, status: error ? 'error' : 'done' } : t));
}

export function CodexPanel({ panelId, projectId }: Props) {
  const { messages: store, setMessages, projects } = useProjects();
  const { settings } = useSettings();
  const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
  const [messages, setLocal] = useState<ChatMessage[]>(() => store[panelId] ?? []);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [loginInfo, setLoginInfo] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages(panelId, messages); }, [messages, panelId, setMessages]);

  useEffect(() => {
    if (settings.autoScroll) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, settings.autoScroll]);

  useEffect(() => {
    codexCheck().then(setInstalled);
    codexLoginStatus().then(setLoginInfo);
  }, []);

  // 패널 닫힐 때 세션 핸들만 정리 (codex exec 는 일회성이라 별도 kill 불필요)
  useEffect(() => () => { void codexClearSession(panelId); }, [panelId]);

  useEffect(() => {
    const unlist: UnlistenFn[] = [];

    const ensureStreamingMsg = (prev: ChatMessage[]): ChatMessage[] => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && last.streaming) return prev;
      return [...prev, { role: 'assistant', content: '', tools: [], streaming: true }];
    };
    const updateLast = (prev: ChatMessage[], mut: (m: ChatMessage) => ChatMessage): ChatMessage[] => {
      const next = ensureStreamingMsg(prev);
      const idx = next.length - 1;
      return [...next.slice(0, idx), mut(next[idx])];
    };

    onCodexDelta((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => updateLast(prev, (m) => ({ ...m, content: m.content + e.text })));
    }).then((u) => unlist.push(u));

    onCodexToolStart((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => updateLast(prev, (m) => ({
        ...m,
        tools: [...(m.tools ?? []), {
          id: e.id, tool: e.tool, preview: e.preview, status: 'running',
        }],
      })));
    }).then((u) => unlist.push(u));

    onCodexToolEnd((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => updateLast(prev, (m) => ({
        ...m, tools: completeTool(m.tools ?? [], e.id, e.error),
      })));
    }).then((u) => unlist.push(u));

    onCodexTurnEnd((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => prev.map((m, i) =>
        i === prev.length - 1 && m.role === 'assistant'
          ? { ...m, streaming: false, usage: { input: e.input_tokens, output: e.output_tokens } }
          : m,
      ));
      setStreaming(false);
    }).then((u) => unlist.push(u));

    onCodexError((e) => {
      if (e.panel_id !== panelId) return;
      setError(e.message);
      setStreaming(false);
    }).then((u) => unlist.push(u));

    return () => { unlist.forEach((u) => u()); };
  }, [panelId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    if (!projectPath) { setError('프로젝트 경로 없음'); return; }
    setDraft('');
    setError(null);
    setLocal((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming(true);
    try {
      await codexSend(panelId, projectPath, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(false);
    }
  }, [draft, streaming, panelId, projectPath]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      const shouldSend = settings.enterToSend ? !e.shiftKey : e.shiftKey;
      if (shouldSend) { e.preventDefault(); void send(); }
    }
  }

  if (installed === false) {
    return (
      <div className="chat">
        <div className="chat-error" style={{ margin: 16 }}>
          <strong>Codex CLI 가 설치되지 않았습니다.</strong>
          <br />설치: <code>npm install -g @openai/codex</code>
          <br />또는 <code>brew install codex</code>
        </div>
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Codex · {loginInfo || '로그인 확인 중'}
            <br />매 턴 'codex exec --json' 자동 spawn. 첫 턴 후 thread_id 로 자동 resume.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <div className="msg-head">
              <span className="msg-role">{m.role}</span>
              {m.content && <CopyButton text={m.content} />}
            </div>
            <div className="msg-body">
              {m.role === 'assistant' ? (
                <>
                  {m.tools?.map((t, ti) => <ToolCard key={t.id ?? ti} tool={t} />)}
                  {m.content
                    ? <Markdown content={m.content} />
                    : (m.streaming ? '…' : null)}
                </>
              ) : m.content}
            </div>
            {m.role === 'assistant' && settings.showTokenUsage && m.usage && (
              <div className="msg-meta">
                <span>↑{m.usage.input} ↓{m.usage.output}</span>
              </div>
            )}
          </div>
        ))}
        {error && <div className="chat-error">⚠ {error}</div>}
      </div>
      <div className="chat-composer">
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Codex 메시지… (Enter 전송, Shift+Enter 줄바꿈)"
            rows={2}
          />
          {streaming
            ? <button className="btn btn-stop" disabled>실행 중…</button>
            : <button className="btn" onClick={() => void send()} disabled={!draft.trim()}>전송</button>}
        </div>
      </div>
    </div>
  );
}
