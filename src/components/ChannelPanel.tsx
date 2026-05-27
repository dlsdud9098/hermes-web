// Discord 식 Hermes 채널 패널.
//   - 메시지 보내면 LLM 채팅 안 됨 (그 자리)
//   - 메시지 = 새 스레드 생성 → 별도 dockview 패널로 열림 → 거기서 LLM 채팅
//   - 채널 자체는 과거 스레드 목록 + 컴포저
//
// chatProvider === 'hermes' 일 때만 사용. Claude/Codex 는 기존 직접 채팅 패널.

import { useCallback, useState } from 'react';
import { DockviewApi } from 'dockview';
import { useProjects, uid } from '../store/projects';
import { useSettings } from '../store/settings';
import type { ThreadMeta } from '../types';
import { createKanban } from '../api/kanban';
import { isTauri } from '../runtime';

interface Props {
  panelId: string;            // 채널 패널 자체 id (안 쓰지만 dockview prop)
  projectId: string;
  /** dockview api — 스레드 열 때 addPanel */
  getApi: () => DockviewApi | null;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ChannelPanel({ projectId, getApi }: Props) {
  const { projects, addHermesThread, removeHermesThread, renameHermesThread } = useProjects();
  const { settings } = useSettings();
  const project = projects.find((p) => p.id === projectId);
  const threads = project?.hermesThreads ?? [];

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const openThread = useCallback((thread: ThreadMeta, initialMessage?: string) => {
    const api = getApi();
    if (!api) return;
    // 이미 열린 패널 있으면 활성화만
    const existing = api.panels.find((p) => p.api.id === thread.id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    api.addPanel({
      id: thread.id,
      component: 'chat',
      title: thread.title || '새 스레드',
      params: { projectId, initialMessage },
    });
  }, [getApi, projectId]);

  function startNew() {
    const text = draft.trim();
    if (!text) return;
    const threadId = uid('thread');
    const title = text.length > 48 ? text.slice(0, 48) + '…' : text;
    const meta: ThreadMeta = { id: threadId, title, createdAtMs: Date.now() };
    addHermesThread(projectId, meta);
    setDraft('');
    openThread(meta, text);
    // 스레드 = kanban task. session_id 로 연결.
    if (isTauri) {
      createKanban({ title, body: text, session_id: threadId })
        .catch(() => { /* kanban.db 없으면 무시 — `hermes kanban init` 권장 */ });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      const shouldSend = settings.enterToSend ? !e.shiftKey : e.shiftKey;
      if (shouldSend) {
        e.preventDefault();
        startNew();
      }
    }
  }

  function commitRename(id: string) {
    const t = editTitle.trim();
    if (t) renameHermesThread(projectId, id, t);
    setEditingId(null);
  }

  // 정렬 — 최근 생성 위로
  const sorted = [...threads].sort((a, b) => b.createdAtMs - a.createdAtMs);

  return (
    <div className="channel">
      <div className="channel-head"># Hermes 채널 · 메시지가 곧 스레드</div>
      <div className="channel-log">
        {sorted.length === 0 && (
          <div className="channel-empty">
            아직 스레드 없음. 아래 메시지 입력 → 새 스레드 시작
          </div>
        )}
        {sorted.map((t) => (
          <div key={t.id} className="channel-thread">
            <div className="channel-thread-meta">{fmtTime(t.createdAtMs)}</div>
            <div className="channel-thread-row">
              {editingId === t.id ? (
                <input
                  className="channel-thread-rename"
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(t.id);
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <button
                  className="channel-thread-title"
                  onClick={() => openThread(t)}
                  onDoubleClick={() => { setEditingId(t.id); setEditTitle(t.title); }}
                  title="클릭: 열기 · 더블클릭: 이름 변경"
                >
                  {t.title || '(빈 스레드)'}
                </button>
              )}
              <button
                className="channel-thread-x"
                onClick={() => {
                  if (window.confirm(`스레드 '${t.title}' 삭제? (대화 기록 같이 삭제)`)) {
                    removeHermesThread(projectId, t.id);
                  }
                }}
                title="스레드 삭제"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="channel-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지 — Enter 로 새 스레드 시작 (Shift+Enter 줄바꿈)"
          rows={2}
        />
        <button className="btn" onClick={startNew} disabled={!draft.trim()}>
          새 스레드
        </button>
      </div>
    </div>
  );
}

