// 한 패널 = 한 Hermes 세션 채팅. dockview 패널 component 로 등록됨.
// 컴포저에서 '/' 로 시작하면 스킬 자동완성 메뉴가 뜬다 (Claude Code 식).

import { useEffect, useMemo, useRef, useState } from 'react';
import { streamChat, HermesApiError } from '../api/hermes';
import { listSkills, type Skill } from '../api/skills';
import { useProjects } from '../store/projects';
import { SkillMenu } from './SkillMenu';
import { Markdown } from './Markdown';
import type { ChatMessage } from '../types';

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
    setLocal([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let acc = '';
      // 세션 id = panelId. Hermes 가 히스토리를 유지하므로 새 메시지만 전송.
      // 메시지가 '/스킬명' 이면 Hermes 가 슬래시 명령으로 해석해 스킬을 실행.
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
              {m.role === 'assistant'
                ? (m.content ? <Markdown content={m.content} /> : (streaming ? '…' : ''))
                : m.content}
            </div>
          </div>
        ))}
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
