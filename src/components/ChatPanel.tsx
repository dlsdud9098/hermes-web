// 한 패널 = 한 Hermes 세션 채팅. dockview 패널 component 로 등록됨.
// 컴포저에서 '/' 로 시작하면 스킬 자동완성 메뉴가 뜬다 (Claude Code 식).

import { useEffect, useMemo, useRef, useState } from 'react';
import { streamRun, approveRun, HermesApiError } from '../api/hermes';
import { listSkills, type Skill } from '../api/skills';
import { useProjects } from '../store/projects';
import { SkillMenu } from './SkillMenu';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { ApprovalCard } from './ApprovalCard';
import type { ChatMessage, ToolCall } from '../types';

interface PendingApproval {
  runId: string;
  command: string;
  description: string;
  choices: string[];
}

/** tool-end 이벤트를 받아 마지막 running 상태의 동명 툴을 완료 처리 */
function completeTool(tools: ToolCall[], tool: string, duration: number, error: boolean): ToolCall[] {
  const next = [...tools];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].status === 'running' && next[i].tool === tool) {
      next[i] = { ...next[i], status: error ? 'error' : 'done', duration };
      break;
    }
  }
  return next;
}

interface ChatPanelProps {
  panelId: string;
  projectId: string;
}

const MAX_SKILL_RESULTS = 60;

export function ChatPanel({ panelId, projectId }: ChatPanelProps) {
  const { messages: store, setMessages, projects } = useProjects();
  const projectPath = projects.find((p) => p.id === projectId)?.path ?? '';
  const [messages, setLocal] = useState<ChatMessage[]>(() => store[panelId] ?? []);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillIndex, setSkillIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 로컬 상태 → store 동기화 (패널 remount 시에도 히스토리 유지)
  useEffect(() => { setMessages(panelId, messages); }, [messages, panelId, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // 스킬 목록 1회 로드 (실패해도 채팅은 정상 동작)
  useEffect(() => {
    listSkills().then(setSkills).catch(() => { /* 스킬 목록 없이 진행 */ });
  }, []);

  // draft 가 '/단어' 꼴이면 슬래시 쿼리, 아니면 null (공백 들어가면 닫힘)
  const slashQuery = useMemo(() => {
    const m = draft.match(/^\/([a-z0-9-]*)$/);
    return m ? m[1] : null;
  }, [draft]);

  const filteredSkills = useMemo(() => {
    if (slashQuery === null) return [];
    return skills
      .filter((s) => s.name.includes(slashQuery))
      .slice(0, MAX_SKILL_RESULTS);
  }, [skills, slashQuery]);

  const menuOpen = slashQuery !== null && !menuDismissed && filteredSkills.length > 0;

  useEffect(() => { setSkillIndex(0); }, [slashQuery]);

  function pickSkill(skill: Skill) {
    setDraft(`/${skill.name} `);
    setMenuDismissed(false);
  }

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    setError(null);
    setDraft('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = [...messages, userMsg];
    let assistant: ChatMessage = { role: 'assistant', content: '', tools: [] };
    setLocal([...history, assistant]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // 세션 id = panelId. Hermes 가 히스토리를 유지하므로 새 메시지만 전송.
      // 메시지가 '/스킬명' 이면 Hermes 가 슬래시 명령으로 해석해 스킬을 실행.
      for await (const ev of streamRun({
        sessionId: panelId,
        projectId,
        projectPath,
        message: text,
        signal: ac.signal,
      })) {
        if (ev.type === 'text') {
          assistant = { ...assistant, content: assistant.content + ev.delta };
        } else if (ev.type === 'tool-start') {
          assistant = {
            ...assistant,
            tools: [...(assistant.tools ?? []), { tool: ev.tool, preview: ev.preview, status: 'running' }],
          };
        } else if (ev.type === 'tool-end') {
          assistant = {
            ...assistant,
            tools: completeTool(assistant.tools ?? [], ev.tool, ev.duration, ev.error),
          };
        } else if (ev.type === 'approval') {
          setPendingApproval({
            runId: ev.runId,
            command: ev.command,
            description: ev.description,
            choices: ev.choices,
          });
        } else if (ev.type === 'approval-resolved') {
          setPendingApproval(null);
        } else if (ev.type === 'done') {
          if (!assistant.content && ev.output) assistant = { ...assistant, content: ev.output };
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
        setLocal([...history, assistant]);
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
      setPendingApproval(null);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function handleApprove(choice: string) {
    if (!pendingApproval) return;
    setApprovalBusy(true);
    try {
      await approveRun(pendingApproval.runId, choice);
      setPendingApproval(null); // 서버가 런을 재개하면 SSE 이벤트가 이어진다
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApprovalBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      const len = filteredSkills.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSkillIndex((i) => (i + 1) % len);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSkillIndex((i) => (i - 1 + len) % len);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSkill(filteredSkills[skillIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">메시지를 입력해 세션 시작 · '/' 로 스킬 호출</div>
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
                    : (streaming && !m.tools?.length ? '…' : null)}
                </>
              ) : m.content}
            </div>
          </div>
        ))}
        {pendingApproval && (
          <ApprovalCard
            command={pendingApproval.command}
            description={pendingApproval.description}
            choices={pendingApproval.choices}
            busy={approvalBusy}
            onChoose={handleApprove}
          />
        )}
        {error && <div className="chat-error">⚠ {error}</div>}
      </div>
      <div className="chat-composer">
        {menuOpen && (
          <SkillMenu skills={filteredSkills} selectedIndex={skillIndex} onPick={pickSkill} />
        )}
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setMenuDismissed(false); }}
          onKeyDown={onKeyDown}
          placeholder="메시지… (Enter 전송, Shift+Enter 줄바꿈, / 스킬)"
          rows={2}
        />
        {streaming
          ? <button className="btn btn-stop" onClick={stop}>중단</button>
          : <button className="btn" onClick={send} disabled={!draft.trim()}>전송</button>}
      </div>
    </div>
  );
}
