// Kanban 카드 상세 드로어 — 우측 슬라이드인.
//   개요(필드/결과/에러) · 이벤트(task_events) · 실행(task_runs) · 코멘트
// 2초 폴링으로 events/runs 최신화 (board 폴링과 별개).

import { useCallback, useEffect, useState } from 'react';
import {
  detailKanban, commentKanban, diffKanban, cleanupKanban,
  moveKanban, deleteKanban,
  type KanbanTask, type KanbanDetail, type KanbanDiff, type KanbanStatus,
} from '../api/kanban';

interface Props {
  task: KanbanTask;
  onClose: () => void;
}

type Tab = 'overview' | 'diff' | 'events' | 'runs' | 'comments';

function fmtTs(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function prettyPayload(raw: string | null): string {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw);
    if (obj.from && obj.to) return `${obj.from} → ${obj.to}`;
    if (obj.title) return String(obj.title);
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
  } catch {
    return raw;
  }
}

function renderDiff(text: string) {
  return text.split('\n').map((line, i) => {
    let cls = 'diff-ctx';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-del';
    else if (line.startsWith('@@')) cls = 'diff-hunk';
    else if (line.startsWith('diff ') || line.startsWith('index ')
      || line.startsWith('+++') || line.startsWith('---') || line.startsWith('??')) cls = 'diff-meta';
    return <span key={i} className={`diff-line ${cls}`}>{line || ' '}</span>;
  });
}

export function KanbanDetail({ task, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [detail, setDetail] = useState<KanbanDetail | null>(null);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [diff, setDiff] = useState<KanbanDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await detailKanban(task.id);
      setDetail(d);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, [task.id]);

  useEffect(() => {
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [load]);

  const loadDiff = useCallback(async () => {
    setDiffLoading(true);
    try {
      const d = await diffKanban(task.id);
      setDiff(d);
    } catch (e) { setErr(String(e)); }
    finally { setDiffLoading(false); }
  }, [task.id]);

  useEffect(() => {
    if (tab === 'diff' && !diff) loadDiff();
  }, [tab, diff, loadDiff]);

  async function submitComment() {
    const b = comment.trim();
    if (!b) return;
    setComment('');
    try {
      await commentKanban(task.id, b);
      await load();
    } catch (e) { setErr(String(e)); }
  }

  async function doMove(status: KanbanStatus) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await moveKanban(task.id, status);
      await load();
      setNotice(`→ ${status}`);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  async function doCleanup() {
    if (busy) return;
    if (!window.confirm('워크트리 제거? 커밋 안 된 변경분 있으면 실패함.')) return;
    setBusy(true);
    setNotice(null);
    try {
      const msg = await cleanupKanban(task.id);
      setNotice(msg);
      await load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (busy) return;
    if (!window.confirm('태스크 삭제? 이벤트/실행/코멘트 모두 같이 삭제됨.')) return;
    setBusy(true);
    try {
      await deleteKanban(task.id);
      onClose();
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  const isWorktree = task.workspace_kind === 'worktree';

  return (
    <div className="kanban-detail">
      <div className="kanban-detail-head">
        <span className={`kanban-badge kanban-badge-${task.status}`}>{task.status}</span>
        <span className="kanban-detail-title">{task.title}</span>
        <button className="modal-x" onClick={onClose}>✕</button>
      </div>
      <div className="kanban-detail-actions">
        {task.status !== 'running' && (
          <button className="kanban-act" disabled={busy} onClick={() => doMove('running')}>▶ 실행</button>
        )}
        {task.status !== 'blocked' && task.status !== 'done' && (
          <button className="kanban-act" disabled={busy} onClick={() => doMove('blocked')}>⏸ 보류</button>
        )}
        {task.status === 'blocked' && (
          <button className="kanban-act" disabled={busy} onClick={() => doMove('todo')}>↩ 해제</button>
        )}
        {task.status !== 'done' && (
          <button className="kanban-act kanban-act-done" disabled={busy} onClick={() => doMove('done')}>✓ 완료</button>
        )}
        {task.status !== 'archived' && (
          <button className="kanban-act" disabled={busy} onClick={() => doMove('archived')}>🗄 보관</button>
        )}
        {isWorktree && (
          <button className="kanban-act" disabled={busy} onClick={doCleanup} title="git worktree remove">🧹 정리</button>
        )}
        <button className="kanban-act kanban-act-del" disabled={busy} onClick={doDelete}>🗑 삭제</button>
      </div>
      {notice && <div className="kanban-notice">{notice}</div>}
      <div className="kanban-detail-tabs">
        {(['overview', 'diff', 'events', 'runs', 'comments'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`kanban-detail-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'overview' ? '개요'
              : t === 'diff' ? '변경'
              : t === 'events' ? `이벤트 ${detail ? `(${detail.events.length})` : ''}`
              : t === 'runs' ? `실행 ${detail ? `(${detail.runs.length})` : ''}`
              : `코멘트 ${detail ? `(${detail.comments.length})` : ''}`}
          </button>
        ))}
      </div>
      {err && <div className="kanban-err">⚠ {err}</div>}
      <div className="kanban-detail-body">
        {tab === 'overview' && (
          <dl className="kanban-fields">
            <dt>ID</dt><dd className="mono">{task.id}</dd>
            <dt>상태</dt><dd>{task.status}</dd>
            <dt>담당</dt><dd>{task.assignee ?? '—'}</dd>
            <dt>우선순위</dt><dd>{task.priority}</dd>
            <dt>생성</dt><dd>{fmtTs(task.created_at)} · {task.created_by ?? '?'}</dd>
            <dt>시작</dt><dd>{fmtTs(task.started_at)}</dd>
            <dt>완료</dt><dd>{fmtTs(task.completed_at)}</dd>
            <dt>워크스페이스</dt><dd className="mono">{task.workspace_kind}{task.workspace_path ? ` · ${task.workspace_path}` : ''}</dd>
            <dt>세션</dt><dd className="mono">{task.session_id ?? '—'}</dd>
            <dt>연속 실패</dt><dd>{task.consecutive_failures}</dd>
            {task.body && (<><dt>본문</dt><dd className="kanban-body-text">{task.body}</dd></>)}
            {task.result && (<><dt>결과</dt><dd className="kanban-body-text">{task.result}</dd></>)}
            {task.last_failure_error && (
              <><dt>마지막 에러</dt><dd className="kanban-err-text">{task.last_failure_error}</dd></>
            )}
          </dl>
        )}
        {tab === 'diff' && (
          <div className="kanban-diff-wrap">
            <div className="kanban-diff-bar">
              <span className="mono">{diff?.branch_name ?? task.branch_name ?? '브랜치 없음'}</span>
              <button className="kanban-act" disabled={diffLoading} onClick={loadDiff}>
                {diffLoading ? '⟳' : '↻ 새로고침'}
              </button>
            </div>
            {diffLoading && <div className="kanban-empty">로딩…</div>}
            {!diffLoading && diff?.note && <div className="kanban-empty">{diff.note}</div>}
            {!diffLoading && diff?.diff && (
              <pre className="kanban-diff">{renderDiff(diff.diff)}</pre>
            )}
          </div>
        )}
        {tab === 'events' && (
          <div className="kanban-timeline">
            {detail?.events.length === 0 && <div className="kanban-empty">이벤트 없음</div>}
            {detail?.events.map((ev) => (
              <div key={ev.id} className="kanban-event">
                <span className="kanban-event-kind">{ev.kind}</span>
                <span className="kanban-event-payload">{prettyPayload(ev.payload)}</span>
                <span className="kanban-event-time">{fmtTs(ev.created_at)}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'runs' && (
          <div className="kanban-runs">
            {detail?.runs.length === 0 && <div className="kanban-empty">실행 기록 없음</div>}
            {detail?.runs.map((r) => (
              <div key={r.id} className="kanban-run">
                <div className="kanban-run-head">
                  <span className={`kanban-badge kanban-badge-${r.status}`}>{r.status}</span>
                  {r.outcome && <span className="kanban-run-outcome">{r.outcome}</span>}
                  {r.worker_pid && <span className="kanban-run-pid">pid {r.worker_pid}</span>}
                </div>
                <div className="kanban-run-meta">
                  {fmtTs(r.started_at)} → {fmtTs(r.ended_at)}
                  {r.profile && ` · ${r.profile}`}
                </div>
                {r.summary && <div className="kanban-run-summary">{r.summary}</div>}
                {r.error && <div className="kanban-err-text">{r.error}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === 'comments' && (
          <div className="kanban-comments">
            <div className="kanban-comment-list">
              {detail?.comments.length === 0 && <div className="kanban-empty">코멘트 없음</div>}
              {detail?.comments.map((cm) => (
                <div key={cm.id} className="kanban-comment">
                  <div className="kanban-comment-meta">
                    <span className="kanban-comment-author">{cm.author}</span>
                    <span className="kanban-comment-time">{fmtTs(cm.created_at)}</span>
                  </div>
                  <div className="kanban-comment-body">{cm.body}</div>
                </div>
              ))}
            </div>
            <div className="kanban-comment-composer">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
                }}
                placeholder="코멘트 — Ctrl/Cmd+Enter 로 추가"
                rows={2}
              />
              <button className="btn" onClick={submitComment} disabled={!comment.trim()}>
                추가
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
