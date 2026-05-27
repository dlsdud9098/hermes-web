// Hermes kanban 보드 — 5컬럼 (Todo / Ready / Running / Blocked / Done) D&D 이동.
// 데이터는 ~/.hermes/kanban.db 직접 읽음. 외부 변경 감지를 위해 2초 폴링.
//
// "보드 열기" 버튼이 ChannelPanel 헤더에 있고 클릭 시 dockview 에 'kanban' 패널 추가.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listKanban, createKanban, moveKanban, deleteKanban, editKanban,
  type KanbanTask, type KanbanStatus,
} from '../api/kanban';
import { KanbanDetail } from './KanbanDetail';

interface Column {
  status: KanbanStatus;
  label: string;
  /** 같은 컬럼에 매핑되는 추가 status (예: Todo 컬럼은 triage/todo/scheduled 다 받음) */
  extra: KanbanStatus[];
}

const COLUMNS: Column[] = [
  { status: 'todo',    label: 'Todo',    extra: ['triage', 'scheduled'] },
  { status: 'ready',   label: 'Ready',   extra: [] },
  { status: 'running', label: 'Running', extra: [] },
  { status: 'blocked', label: 'Blocked', extra: [] },
  { status: 'review',  label: 'Review',  extra: [] },
  { status: 'done',    label: 'Done',    extra: [] },
];

type Activity = 'thinking' | 'idle' | 'waiting' | 'none';

/** 활동 상태 — 카드 도트. running + 최근 heartbeat(<30s) = thinking, blocked = waiting */
function activityOf(t: KanbanTask): Activity {
  if (t.status === 'blocked' || t.status === 'review') return 'waiting';
  if (t.status === 'running') {
    const hb = t.last_heartbeat_at;
    if (hb && Date.now() / 1000 - hb < 30) return 'thinking';
    return 'idle';
  }
  return 'none';
}

const ACT_TITLE: Record<Activity, string> = {
  thinking: '작업 중 (heartbeat 최근)',
  idle: '실행 상태지만 heartbeat 끊김',
  waiting: '대기 — 사용자 입력/리뷰 필요',
  none: '',
};

function fmtRel(ts: number | null): string {
  if (!ts) return '';
  const ms = ts * 1000;
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(ms).toLocaleDateString();
}

export function KanbanPanel() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const dragRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listKanban(false);
      setTasks(list);
      setLastSync(Date.now());
      setErr(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 2000);
    return () => clearInterval(id);
  }, [reload]);

  const grouped = useMemo(() => {
    const map = new Map<KanbanStatus, KanbanTask[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const t of tasks) {
      let dest = COLUMNS.find((c) => c.status === t.status || c.extra.includes(t.status));
      if (!dest) dest = COLUMNS[0];
      map.get(dest.status)!.push(t);
    }
    return map;
  }, [tasks]);

  async function addTask() {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    try {
      await createKanban({ title });
      await reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  function onDragStart(e: React.DragEvent, id: string) {
    dragRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-kanban-task', id);
  }

  function onColDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-kanban-task')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function onColDrop(e: React.DragEvent, status: KanbanStatus) {
    const id = e.dataTransfer.getData('application/x-kanban-task') || dragRef.current;
    dragRef.current = null;
    if (!id) return;
    e.preventDefault();
    const cur = tasks.find((t) => t.id === id);
    if (!cur || cur.status === status) return;
    // 낙관 업데이트
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await moveKanban(id, status);
    } catch (er) {
      setErr(String(er));
      await reload();
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('이 태스크 삭제? 댓글/이벤트 모두 같이 삭제됨.')) return;
    try {
      await deleteKanban(id);
      await reload();
    } catch (e) { setErr(String(e)); }
  }

  function startEdit(t: KanbanTask) {
    setEditingId(t.id);
    setEditTitle(t.title);
  }

  async function commitEdit(id: string) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await editKanban(id, { title });
      await reload();
    } catch (e) { setErr(String(e)); }
  }

  const selected = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div className={`kanban${selected ? ' kanban-with-detail' : ''}`}>
      <div className="kanban-main">
      <div className="kanban-head">
        <span className="kanban-title">📋 Hermes Kanban</span>
        <span className="kanban-count">총 {tasks.length}</span>
        <button
          className="kanban-refresh"
          onClick={reload}
          disabled={loading}
          title="수동 새로고침"
        >{loading ? '⟳' : '↻'}</button>
        <span className="kanban-sync">
          {lastSync
            ? `마지막 갱신 ${new Date(lastSync).toLocaleTimeString()}`
            : '갱신 대기'}
        </span>
        <div className="kanban-composer">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
            placeholder="새 태스크 제목 — Enter 로 추가"
          />
          <button className="btn" onClick={addTask} disabled={!draft.trim()}>+ 추가</button>
        </div>
      </div>
      {err && <div className="kanban-err">⚠ {err}</div>}
      <div className="kanban-board">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.status) ?? [];
          return (
            <div
              key={col.status}
              className={`kanban-col kanban-col-${col.status}`}
              onDragOver={onColDragOver}
              onDrop={(e) => onColDrop(e, col.status)}
            >
              <div className="kanban-col-head">
                <span className="kanban-col-label">{col.label}</span>
                <span className="kanban-col-count">{items.length}</span>
              </div>
              <div className="kanban-col-body">
                {items.length === 0 && <div className="kanban-empty">비어있음</div>}
                {items.map((t) => (
                  <div
                    key={t.id}
                    className={`kanban-card${selectedId === t.id ? ' selected' : ''}`}
                    draggable
                    onDragStart={(e) => onDragStart(e, t.id)}
                    onClick={() => { if (editingId !== t.id) setSelectedId(t.id); }}
                  >
                    <div className="kanban-card-row">
                      {activityOf(t) !== 'none' && (
                        <span
                          className={`kanban-dot kanban-dot-${activityOf(t)}`}
                          title={ACT_TITLE[activityOf(t)]}
                        />
                      )}
                      {editingId === t.id ? (
                        <input
                          className="kanban-card-edit"
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => commitEdit(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(t.id);
                            else if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        <button
                          className="kanban-card-title"
                          onClick={(e) => { e.stopPropagation(); setSelectedId(t.id); }}
                          onDoubleClick={(e) => { e.stopPropagation(); startEdit(t); }}
                          title="클릭: 상세 · 더블클릭: 제목 수정"
                        >
                          {t.title}
                        </button>
                      )}
                      <button
                        className="kanban-card-x"
                        onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                        title="삭제"
                      >✕</button>
                    </div>
                    <div className="kanban-card-meta">
                      <span className="kanban-card-id">{t.id}</span>
                      {t.assignee && <span className="kanban-card-assignee">@{t.assignee}</span>}
                      <span className="kanban-card-time">{fmtRel(t.created_at)}</span>
                    </div>
                    {t.last_failure_error && (
                      <div className="kanban-card-err" title={t.last_failure_error}>
                        ⚠ {t.last_failure_error.slice(0, 80)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      {selected && (
        <KanbanDetail task={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
