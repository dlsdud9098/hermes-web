// Claude Code 인터랙티브 PTY 패널 — 블록 단위 스트리밍.
//
// 이벤트 흐름:
//   - claude:delta      → 진행 중 assistant 메시지에 텍스트 append (블록 단위)
//   - claude:tool-start → ToolCard running 추가
//   - claude:tool-end   → 해당 id 의 ToolCard done/error 처리
//   - claude:turn-end   → streaming=false, 다음 입력 가능
//
// 패널 unmount 시 PTY 자동 종료(claude_stop). 같은 프로세스 그룹 SIGKILL 로
// claude 가 띄운 도구 서브프로세스까지 일괄 정리.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  claudeStart, claudeSend, claudeStop, claudeCheck,
  onClaudeDelta, onClaudeToolStart, onClaudeToolEnd, onClaudeTurnEnd,
  type ClaudeStatus,
} from '../api/claudeCli';
import { listSkills, type Skill } from '../api/skills';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { CopyButton } from './CopyButton';
import { SkillMenu } from './SkillMenu';
import type { ChatMessage, ToolCall } from '../types';
import type { UnlistenFn } from '@tauri-apps/api/event';

const MAX_SKILL_RESULTS = 60;

interface Props {
  panelId: string;
  projectId: string;
}

/** id 로 마지막 running ToolCard 를 찾아 상태 갱신 */
function completeTool(tools: ToolCall[], id: string, error: boolean): ToolCall[] {
  return tools.map((t) => (t.id === id ? { ...t, status: error ? 'error' : 'done' } : t));
}

export function ClaudeCodePanel({ panelId, projectId }: Props) {
  const { messages: store, setMessages, projects } = useProjects();
  const { settings } = useSettings();
  const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
  const [messages, setLocal] = useState<ChatMessage[]>(() => store[panelId] ?? []);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [started, setStarted] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillIdx, setSkillIdx] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listSkills('claude').then(setSkills).catch(() => { /* 빈 목록 */ });
  }, []);

  const slashQuery = useMemo(() => {
    const m = draft.match(/^\/([a-z0-9-]*)$/);
    return m ? m[1] : null;
  }, [draft]);

  const filteredSkills = useMemo(() => {
    if (slashQuery === null) return [];
    return skills.filter((s) => s.name.includes(slashQuery)).slice(0, MAX_SKILL_RESULTS);
  }, [skills, slashQuery]);

  const menuOpen = slashQuery !== null && !menuDismissed && filteredSkills.length > 0;
  useEffect(() => { setSkillIdx(0); }, [slashQuery]);

  function pickSkill(skill: Skill) {
    setDraft(`/${skill.name} `);
    setMenuDismissed(false);
  }

  useEffect(() => { setMessages(panelId, messages); }, [messages, panelId, setMessages]);

  useEffect(() => {
    if (settings.autoScroll) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, settings.autoScroll]);

  // 마운트: claude 설치/로그인 상태 확인
  useEffect(() => {
    claudeCheck().then(setStatus).catch(() => {});
  }, []);

  // 패널 unmount → PTY + 프로세스 그룹 정리
  useEffect(() => () => { void claudeStop(panelId); }, [panelId]);

  // 스트리밍 이벤트 구독 — 본 패널 것만 처리
  useEffect(() => {
    const unlist: UnlistenFn[] = [];

    const ensureStreamingMsg = (prev: ChatMessage[]): ChatMessage[] => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && last.streaming) return prev;
      return [...prev, { role: 'assistant', content: '', tools: [], streaming: true }];
    };
    const updateLast = (
      prev: ChatMessage[],
      mutator: (m: ChatMessage) => ChatMessage,
    ): ChatMessage[] => {
      const next = ensureStreamingMsg(prev);
      const idx = next.length - 1;
      const updated = mutator(next[idx]);
      return [...next.slice(0, idx), updated];
    };

    onClaudeDelta((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => updateLast(prev, (m) => ({ ...m, content: m.content + e.text })));
    }).then((u) => unlist.push(u));

    onClaudeToolStart((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => updateLast(prev, (m) => ({
        ...m,
        tools: [...(m.tools ?? []), {
          id: e.id, tool: e.tool, preview: e.preview, status: 'running',
        }],
      })));
    }).then((u) => unlist.push(u));

    onClaudeToolEnd((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => updateLast(prev, (m) => ({
        ...m,
        tools: completeTool(m.tools ?? [], e.id, e.error),
      })));
    }).then((u) => unlist.push(u));

    onClaudeTurnEnd((e) => {
      if (e.panel_id !== panelId) return;
      setLocal((prev) => prev.map((m, i) =>
        i === prev.length - 1 && m.role === 'assistant' ? { ...m, streaming: false } : m,
      ));
      setStreaming(false);
    }).then((u) => unlist.push(u));

    return () => { unlist.forEach((u) => u()); };
  }, [panelId]);

  const start = useCallback(async () => {
    if (!projectPath) {
      setError('프로젝트 경로 없음');
      return false;
    }
    try {
      await claudeStart(panelId, projectPath);
      setStarted(true);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [panelId, projectPath]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    if (!started) {
      const ok = await start();
      if (!ok) return;
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
    if (menuOpen) {
      const len = filteredSkills.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSkillIdx((i) => (i + 1) % len); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSkillIdx((i) => (i - 1 + len) % len); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); pickSkill(filteredSkills[skillIdx]); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMenuDismissed(true); return; }
    }
    if (e.key === 'Enter') {
      const shouldSend = settings.enterToSend ? !e.shiftKey : e.shiftKey;
      if (shouldSend) {
        e.preventDefault();
        void send();
      }
    }
  }

  // 설치/로그인 가드
  if (status && (!status.installed || !status.logged_in)) {
    return (
      <div className="chat">
        <div className="chat-log">
          <div className="chat-error" style={{ margin: 16 }}>
            <strong>Claude Code 사용 준비가 안 되어 있습니다.</strong>
            <ul style={{ marginTop: 8 }}>
              {!status.installed && <li>설치: <code>npm install -g @anthropic-ai/claude-code</code></li>}
              {status.installed && !status.logged_in && (
                <li>로그인: 터미널에서 <code>claude</code> 한 번 실행하고 Max 계정 로그인 (브라우저 OAuth)</li>
              )}
              <li>설치/로그인 완료 후 이 패널을 닫고 다시 열기</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const isSlash = draft.trim().startsWith('/');

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Claude Code · {status?.version || '확인 중'} · {status?.login_method || ''}
            <br />첫 메시지를 보내면 PTY 안에서 인터랙티브 세션이 시작됩니다.
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
          </div>
        ))}
        {error && <div className="chat-error">⚠ {error}</div>}
      </div>
      <div className="chat-composer">
        {menuOpen && (
          <SkillMenu skills={filteredSkills} selectedIndex={skillIdx} onPick={pickSkill} />
        )}
        {isSlash && !menuOpen && (
          <div className="chat-hint">
            ⓘ 슬래시 명령은 PTY 안의 TUI 메뉴를 띄움 — UI 응답 없을 수 있음
          </div>
        )}
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMenuDismissed(false); }}
            onKeyDown={onKeyDown}
            placeholder="Claude Code 메시지… (Enter 전송, / 스킬)"
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
