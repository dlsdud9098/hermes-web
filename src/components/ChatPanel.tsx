// 한 패널 = 한 Hermes 세션 채팅. dockview 패널 component 로 등록됨.
// 컴포저에서 '/' 로 시작하면 스킬 자동완성 메뉴가 뜬다 (Claude Code 식).

import { useEffect, useMemo, useRef, useState } from 'react';
import { streamRun, approveRun, HermesApiError } from '../api/hermes';
import { listSkills, type Skill } from '../api/skills';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { SkillMenu } from './SkillMenu';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { ApprovalCard } from './ApprovalCard';
import { CopyButton } from './CopyButton';
import type { ChatMessage, ToolCall, ImageAttachment } from '../types';

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
  const { settings } = useSettings();
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
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 이미지 파일 → base64 data URL 변환 후 첨부 목록에 추가
  function addImageFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      if (!dataUrl) return;
      setAttachments((prev) => [...prev, {
        dataUrl, name: file.name, mime: file.type, size: file.size,
      }]);
    };
    reader.readAsDataURL(file);
  }
  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  // 로컬 상태 → store 동기화 (패널 remount 시에도 히스토리 유지)
  useEffect(() => { setMessages(panelId, messages); }, [messages, panelId, setMessages]);

  useEffect(() => {
    if (settings.autoScroll) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, settings.autoScroll]);

  // 스킬 목록 1회 로드 (실패해도 채팅은 정상 동작)
  useEffect(() => {
    listSkills('hermes').then(setSkills).catch(() => { /* 스킬 목록 없이 진행 */ });
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

  // 한 턴 실행 — baseHistory 는 user 메시지까지 포함한 히스토리
  async function runTurn(text: string, baseHistory: ChatMessage[], images?: ImageAttachment[]) {
    setError(null);
    let assistant: ChatMessage = { role: 'assistant', content: '', tools: [] };
    setLocal([...baseHistory, assistant]);
    setStreaming(true);

    const t0 = Date.now();
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
        images: images?.map((a) => ({ dataUrl: a.dataUrl, mime: a.mime })),
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
          assistant = {
            ...assistant,
            content: assistant.content || ev.output,
            usage: ev.usage,
            durationMs: Date.now() - t0,
          };
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
        setLocal([...baseHistory, assistant]);
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // 사용자 중단 — 현재까지 받은 내용 유지
      } else {
        const msg = err instanceof HermesApiError ? err.message
          : err instanceof Error ? err.message : String(err);
        setError(msg);
        setLocal(baseHistory); // 빈 assistant 자리 제거
      }
    } finally {
      setStreaming(false);
      setPendingApproval(null);
      abortRef.current = null;
    }
  }

  function send() {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    const imgs = attachments;
    setDraft('');
    setAttachments([]);
    runTurn(
      text,
      [...messages, { role: 'user', content: text, attachments: imgs }],
      imgs,
    );
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
    if (e.key === 'Enter') {
      // enterToSend: Enter 전송·Shift+Enter 줄바꿈 / false: 반대
      const shouldSend = settings.enterToSend ? !e.shiftKey : e.shiftKey;
      if (shouldSend) {
        e.preventDefault();
        send();
      }
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
            <div className="msg-head">
              <span className="msg-role">{m.role}</span>
              {m.content && <CopyButton text={m.content} />}
            </div>
            <div className="msg-body">
              {m.role === 'assistant' ? (
                <>
                  {m.tools?.map((t, ti) => <ToolCard key={ti} tool={t} />)}
                  {m.content
                    ? <Markdown content={m.content} />
                    : (streaming && !m.tools?.length ? '…' : null)}
                </>
              ) : (
                <>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="msg-images">
                      {m.attachments.map((a, ai) => (
                        <img
                          key={ai}
                          className="msg-image"
                          src={a.dataUrl}
                          alt={a.name ?? '첨부'}
                          loading="lazy"
                          onClick={() => window.open(a.dataUrl, '_blank')}
                        />
                      ))}
                    </div>
                  )}
                  {m.content}
                </>
              )}
            </div>
            {m.role === 'assistant'
              && ((settings.showTiming && m.durationMs != null)
                || (settings.showTokenUsage && m.usage)) && (
              <div className="msg-meta">
                {settings.showTiming && m.durationMs != null && (
                  <span>{(m.durationMs / 1000).toFixed(1)}초</span>
                )}
                {settings.showTokenUsage && m.usage && (
                  <span>↑{m.usage.input} ↓{m.usage.output}</span>
                )}
              </div>
            )}
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
      <div
        className="chat-composer"
        onPaste={(e) => {
          // 클립보드에 이미지 있으면 첨부
          for (const item of Array.from(e.clipboardData?.items ?? [])) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              const f = item.getAsFile();
              if (f) { addImageFile(f); e.preventDefault(); }
            }
          }
        }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          for (const f of Array.from(e.dataTransfer.files)) addImageFile(f);
        }}
      >
        {menuOpen && (
          <SkillMenu skills={filteredSkills} selectedIndex={skillIndex} onPick={pickSkill} />
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a, i) => (
              <div key={i} className="attachment-chip" title={`${a.name ?? '이미지'} · ${Math.round(a.size / 1024)}KB`}>
                <img src={a.dataUrl} alt="" className="attachment-thumb" />
                <button className="attachment-x" onClick={() => removeAttachment(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMenuDismissed(false); }}
            onKeyDown={onKeyDown}
            placeholder="메시지… (Enter 전송, Shift+Enter 줄바꿈, / 스킬, 이미지 paste/drop/📎)"
            rows={2}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) addImageFile(f);
              e.target.value = '';
            }}
          />
          <button
            className="btn btn-ghost composer-attach"
            onClick={() => fileInputRef.current?.click()}
            title="이미지 첨부"
          >
            📎
          </button>
          {streaming
            ? <button className="btn btn-stop" onClick={stop}>중단</button>
            : <button className="btn" onClick={send}
                disabled={!draft.trim() && attachments.length === 0}>전송</button>}
        </div>
      </div>
    </div>
  );
}
