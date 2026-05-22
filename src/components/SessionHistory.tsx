// 프로젝트의 과거 세션(패널) 목록 — 닫힌 세션도 다시 열 수 있다.
// 세션 데이터는 messages store(영속화)에서 온다.

import { useMemo } from 'react';
import { useProjects } from '../store/projects';

interface SessionHistoryPanelProps {
  projectId: string;
  onOpenSession: (panelId: string, title: string) => void;
}

export function SessionHistoryPanel({ projectId, onOpenSession }: SessionHistoryPanelProps) {
  const { sessionMeta, messages } = useProjects();

  const sessions = useMemo(() => {
    return Object.keys(sessionMeta)
      .filter((id) => sessionMeta[id].projectId === projectId)
      .map((id) => {
        const msgs = messages[id] ?? [];
        const firstUser = msgs.find((m) => m.role === 'user');
        return {
          id,
          title: firstUser?.content.trim().slice(0, 60) || '(빈 세션)',
          count: msgs.length,
        };
      })
      .filter((s) => s.count > 0)
      .sort((a, b) => b.id.localeCompare(a.id)); // 최근 세션 먼저
  }, [sessionMeta, messages, projectId]);

  return (
    <div className="sessionhist">
      {sessions.length === 0 && <div className="picker-dim">세션 기록 없음</div>}
      {sessions.map((s) => (
        <button key={s.id} className="sess-row" onClick={() => onOpenSession(s.id, s.title)}>
          <span className="sess-title">{s.title}</span>
          <span className="sess-count">{s.count}</span>
        </button>
      ))}
    </div>
  );
}
