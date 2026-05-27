// Hermes kanban — `~/.hermes/kanban.db` 직접 SQLite 액세스.
// 읽기는 SELECT, 쓰기는 INSERT/UPDATE + task_events 로그 동시 기록.
//
// 상태 전이 규칙:
//   create  → 'todo'  (event: created)
//   move    → 임의 VALID_STATUS (event: status_changed)
//   complete→ 'done'  + completed_at (event: completed)
//   block   → 'blocked' (event: blocked)
//   unblock → 'todo'    (event: unblocked)
//   delete  → tasks/task_events/task_links/task_comments 카스케이드
//
// 외부 hermes 데몬이 같은 DB 를 동시에 변경하므로 WAL + busy_timeout.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct KanbanDb(pub Mutex<Option<Connection>>);

impl Default for KanbanDb {
    fn default() -> Self { Self(Mutex::new(None)) }
}

const VALID_STATUSES: &[&str] = &[
    "triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived",
];

fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("홈 디렉토리 없음".to_string())?;
    Ok(home.join(".hermes").join("kanban.db"))
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn open_conn() -> Result<Connection, String> {
    let p = db_path()?;
    if !p.exists() {
        return Err(format!("kanban.db 없음: {} — `hermes kanban init` 먼저 실행", p.display()));
    }
    let c = Connection::open(&p).map_err(|e| e.to_string())?;
    c.busy_timeout(std::time::Duration::from_millis(2000)).ok();
    c.pragma_update(None, "journal_mode", "WAL").ok();
    c.pragma_update(None, "foreign_keys", "ON").ok();
    Ok(c)
}

fn with_conn<F, T>(state: &KanbanDb, f: F) -> Result<T, String>
where F: FnOnce(&Connection) -> Result<T, String>,
{
    let mut guard = state.0.lock().unwrap();
    if guard.is_none() {
        *guard = Some(open_conn()?);
    }
    let c = guard.as_ref().unwrap();
    f(c)
}

fn append_event(c: &Connection, task_id: &str, kind: &str, payload: Option<&str>) -> Result<(), String> {
    c.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)",
        params![task_id, kind, payload, now_ts()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────── DTO ───────────

#[derive(Serialize)]
pub struct KanbanTask {
    pub id: String,
    pub title: String,
    pub body: Option<String>,
    pub status: String,
    pub assignee: Option<String>,
    pub priority: i64,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub workspace_kind: String,
    pub workspace_path: Option<String>,
    pub session_id: Option<String>,
    pub last_failure_error: Option<String>,
    pub consecutive_failures: i64,
    pub result: Option<String>,
    pub last_heartbeat_at: Option<i64>,
    pub branch_name: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub session_id: Option<String>,
}

// ─────────── 쿼리 ───────────

#[tauri::command]
pub fn kanban_list(state: tauri::State<'_, KanbanDb>, include_archived: Option<bool>) -> Result<Vec<KanbanTask>, String> {
    let include = include_archived.unwrap_or(false);
    with_conn(&state, |c| {
        let sql = if include {
            "SELECT id,title,body,status,assignee,priority,created_by,created_at,started_at,completed_at,\
             workspace_kind,workspace_path,session_id,last_failure_error,consecutive_failures,result,\
             last_heartbeat_at,branch_name \
             FROM tasks ORDER BY priority DESC, created_at DESC"
        } else {
            "SELECT id,title,body,status,assignee,priority,created_by,created_at,started_at,completed_at,\
             workspace_kind,workspace_path,session_id,last_failure_error,consecutive_failures,result,\
             last_heartbeat_at,branch_name \
             FROM tasks WHERE status != 'archived' ORDER BY priority DESC, created_at DESC"
        };
        let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok(KanbanTask {
                id: r.get(0)?,
                title: r.get(1)?,
                body: r.get(2)?,
                status: r.get(3)?,
                assignee: r.get(4)?,
                priority: r.get(5).unwrap_or(0),
                created_by: r.get(6)?,
                created_at: r.get(7).unwrap_or(0),
                started_at: r.get(8)?,
                completed_at: r.get(9)?,
                workspace_kind: r.get(10).unwrap_or_else(|_| "scratch".into()),
                workspace_path: r.get(11)?,
                session_id: r.get(12)?,
                last_failure_error: r.get(13)?,
                consecutive_failures: r.get(14).unwrap_or(0),
                result: r.get(15)?,
                last_heartbeat_at: r.get(16)?,
                branch_name: r.get(17)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[derive(Serialize)]
pub struct TaskEvent {
    pub id: i64,
    pub run_id: Option<i64>,
    pub kind: String,
    pub payload: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct TaskRun {
    pub id: i64,
    pub profile: Option<String>,
    pub step_key: Option<String>,
    pub status: String,
    pub worker_pid: Option<i64>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub outcome: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct TaskComment {
    pub id: i64,
    pub author: String,
    pub body: String,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct KanbanDetail {
    pub events: Vec<TaskEvent>,
    pub runs: Vec<TaskRun>,
    pub comments: Vec<TaskComment>,
}

#[tauri::command]
pub fn kanban_detail(state: tauri::State<'_, KanbanDb>, id: String) -> Result<KanbanDetail, String> {
    with_conn(&state, |c| {
        let mut ev_stmt = c.prepare(
            "SELECT id, run_id, kind, payload, created_at FROM task_events \
             WHERE task_id=? ORDER BY created_at ASC, id ASC",
        ).map_err(|e| e.to_string())?;
        let events: Vec<TaskEvent> = ev_stmt.query_map(params![id], |r| {
            Ok(TaskEvent {
                id: r.get(0)?,
                run_id: r.get(1)?,
                kind: r.get(2)?,
                payload: r.get(3)?,
                created_at: r.get(4).unwrap_or(0),
            })
        }).map_err(|e| e.to_string())?
          .collect::<Result<_, _>>().map_err(|e| e.to_string())?;

        let mut run_stmt = c.prepare(
            "SELECT id, profile, step_key, status, worker_pid, started_at, ended_at, outcome, summary, error \
             FROM task_runs WHERE task_id=? ORDER BY started_at DESC, id DESC",
        ).map_err(|e| e.to_string())?;
        let runs: Vec<TaskRun> = run_stmt.query_map(params![id], |r| {
            Ok(TaskRun {
                id: r.get(0)?,
                profile: r.get(1)?,
                step_key: r.get(2)?,
                status: r.get(3)?,
                worker_pid: r.get(4)?,
                started_at: r.get(5).unwrap_or(0),
                ended_at: r.get(6)?,
                outcome: r.get(7)?,
                summary: r.get(8)?,
                error: r.get(9)?,
            })
        }).map_err(|e| e.to_string())?
          .collect::<Result<_, _>>().map_err(|e| e.to_string())?;

        let mut cm_stmt = c.prepare(
            "SELECT id, author, body, created_at FROM task_comments \
             WHERE task_id=? ORDER BY created_at ASC, id ASC",
        ).map_err(|e| e.to_string())?;
        let comments: Vec<TaskComment> = cm_stmt.query_map(params![id], |r| {
            Ok(TaskComment {
                id: r.get(0)?,
                author: r.get(1)?,
                body: r.get(2)?,
                created_at: r.get(3).unwrap_or(0),
            })
        }).map_err(|e| e.to_string())?
          .collect::<Result<_, _>>().map_err(|e| e.to_string())?;

        Ok(KanbanDetail { events, runs, comments })
    })
}

#[tauri::command]
pub fn kanban_comment(state: tauri::State<'_, KanbanDb>, id: String, body: String) -> Result<(), String> {
    let b = body.trim().to_string();
    if b.is_empty() { return Err("코멘트 비어있음".into()); }
    with_conn(&state, |c| {
        c.execute(
            "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?,?,?,?)",
            params![id, "hermes-web", b, now_ts()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn kanban_create(state: tauri::State<'_, KanbanDb>, input: CreateTaskInput) -> Result<KanbanTask, String> {
    let title = input.title.trim().to_string();
    if title.is_empty() { return Err("title 비어있음".into()); }
    let id = format!("t_{:08x}", rand_u32());
    let ts = now_ts();
    let priority = input.priority.unwrap_or(0);
    with_conn(&state, |c| {
        c.execute(
            "INSERT INTO tasks (id,title,body,status,assignee,priority,created_by,created_at,workspace_kind,consecutive_failures) \
             VALUES (?,?,?,'todo',?,?,?,?,'scratch',0)",
            params![id, title, input.body, input.assignee, priority, "hermes-web", ts],
        ).map_err(|e| e.to_string())?;
        if let Some(sid) = &input.session_id {
            c.execute("UPDATE tasks SET session_id=? WHERE id=?", params![sid, id]).map_err(|e| e.to_string())?;
        }
        append_event(c, &id, "created", Some(&format!("{{\"by\":\"hermes-web\",\"title\":{}}}", json_escape(&title))))?;
        Ok(())
    })?;
    // 새로 만든 row 다시 읽기
    let list = kanban_list(state, Some(false))?;
    list.into_iter().find(|t| t.id == id)
        .ok_or_else(|| "방금 만든 task 조회 실패".to_string())
}

#[tauri::command]
pub fn kanban_move(state: tauri::State<'_, KanbanDb>, id: String, status: String) -> Result<(), String> {
    if !VALID_STATUSES.contains(&status.as_str()) {
        return Err(format!("status 유효하지 않음: {} (허용: {:?})", status, VALID_STATUSES));
    }
    with_conn(&state, |c| {
        let prev: Option<String> = c.query_row(
            "SELECT status FROM tasks WHERE id=?", params![id],
            |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let prev_status = prev.unwrap_or_default();
        let ts = now_ts();
        match status.as_str() {
            "done" => {
                c.execute(
                    "UPDATE tasks SET status='done', completed_at=? WHERE id=?",
                    params![ts, id],
                ).map_err(|e| e.to_string())?;
            }
            "running" => {
                c.execute(
                    "UPDATE tasks SET status='running', started_at=COALESCE(started_at,?) WHERE id=?",
                    params![ts, id],
                ).map_err(|e| e.to_string())?;
            }
            _ => {
                c.execute(
                    "UPDATE tasks SET status=? WHERE id=?",
                    params![status, id],
                ).map_err(|e| e.to_string())?;
            }
        }
        let kind = match status.as_str() {
            "done" => "completed",
            "blocked" => "blocked",
            _ => "status_changed",
        };
        let payload = format!(
            "{{\"from\":{},\"to\":{}}}",
            json_escape(&prev_status), json_escape(&status),
        );
        append_event(c, &id, kind, Some(&payload))?;
        Ok(())
    })
}

#[tauri::command]
pub fn kanban_delete(state: tauri::State<'_, KanbanDb>, id: String) -> Result<(), String> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM task_events WHERE task_id=?", params![id]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM task_comments WHERE task_id=?", params![id]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM task_links WHERE parent_id=? OR child_id=?", params![id, id]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM task_runs WHERE task_id=?", params![id]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM tasks WHERE id=?", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn kanban_edit(
    state: tauri::State<'_, KanbanDb>,
    id: String,
    title: Option<String>,
    body: Option<String>,
    priority: Option<i64>,
    assignee: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |c| {
        if let Some(t) = &title {
            c.execute("UPDATE tasks SET title=? WHERE id=?", params![t, id]).map_err(|e| e.to_string())?;
        }
        if let Some(b) = &body {
            c.execute("UPDATE tasks SET body=? WHERE id=?", params![b, id]).map_err(|e| e.to_string())?;
        }
        if let Some(p) = priority {
            c.execute("UPDATE tasks SET priority=? WHERE id=?", params![p, id]).map_err(|e| e.to_string())?;
        }
        if let Some(a) = &assignee {
            c.execute("UPDATE tasks SET assignee=? WHERE id=?", params![a, id]).map_err(|e| e.to_string())?;
        }
        append_event(c, &id, "edited", None)?;
        Ok(())
    })
}

#[derive(Serialize)]
pub struct KanbanDiff {
    pub workspace_path: Option<String>,
    pub branch_name: Option<String>,
    /// git diff (staged + unstaged + untracked 요약). 워크스페이스 없거나 git 아니면 None.
    pub diff: Option<String>,
    pub note: Option<String>,
}

fn task_workspace(c: &Connection, id: &str) -> Result<(Option<String>, Option<String>, String), String> {
    c.query_row(
        "SELECT workspace_path, branch_name, workspace_kind FROM tasks WHERE id=?",
        params![id],
        |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?)),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kanban_diff(state: tauri::State<'_, KanbanDb>, id: String) -> Result<KanbanDiff, String> {
    let (ws, branch, _kind) = with_conn(&state, |c| task_workspace(c, &id))?;
    let Some(path) = ws.clone() else {
        return Ok(KanbanDiff { workspace_path: None, branch_name: branch, diff: None, note: Some("워크스페이스 경로 없음 (scratch task)".into()) });
    };
    if !std::path::Path::new(&path).exists() {
        return Ok(KanbanDiff { workspace_path: ws, branch_name: branch, diff: None, note: Some(format!("경로 없음: {}", path)) });
    }
    // git diff HEAD — 추적 파일 변경. + untracked 목록.
    let diff_out = std::process::Command::new("git")
        .arg("-C").arg(&path)
        .arg("diff").arg("HEAD")
        .output();
    let untracked = std::process::Command::new("git")
        .arg("-C").arg(&path)
        .arg("ls-files").arg("--others").arg("--exclude-standard")
        .output();
    match diff_out {
        Ok(o) if o.status.success() || !o.stdout.is_empty() => {
            let mut text = String::from_utf8_lossy(&o.stdout).to_string();
            if let Ok(u) = untracked {
                let files = String::from_utf8_lossy(&u.stdout);
                let files = files.trim();
                if !files.is_empty() {
                    text.push_str("\n\n# Untracked files:\n");
                    for f in files.lines() {
                        text.push_str(&format!("?? {}\n", f));
                    }
                }
            }
            if text.trim().is_empty() {
                return Ok(KanbanDiff { workspace_path: ws, branch_name: branch, diff: None, note: Some("변경 없음 (working tree clean)".into()) });
            }
            Ok(KanbanDiff { workspace_path: ws, branch_name: branch, diff: Some(text), note: None })
        }
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr).to_string();
            Ok(KanbanDiff { workspace_path: ws, branch_name: branch, diff: None, note: Some(format!("git diff 실패: {}", err.trim())) })
        }
        Err(e) => Ok(KanbanDiff { workspace_path: ws, branch_name: branch, diff: None, note: Some(format!("git 실행 불가: {}", e)) }),
    }
}

#[tauri::command]
pub fn kanban_cleanup(state: tauri::State<'_, KanbanDb>, id: String) -> Result<String, String> {
    let (ws, branch, kind) = with_conn(&state, |c| task_workspace(c, &id))?;
    if kind != "worktree" {
        return Err(format!("워크트리 task 아님 (kind={}). 클린업 안 함.", kind));
    }
    let Some(path) = ws else {
        return Err("워크트리 경로 없음".into());
    };
    // 부모 repo 에서 worktree remove — path 로 지정. 강제 제거 안 함 (변경분 있으면 실패 → 사용자에게 알림).
    let out = std::process::Command::new("git")
        .arg("-C").arg(&path)
        .arg("worktree").arg("remove").arg(&path)
        .output()
        .map_err(|e| format!("git 실행 불가: {}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("worktree remove 실패 (커밋 안 된 변경분 있을 수 있음): {}", err.trim()));
    }
    with_conn(&state, |c| {
        append_event(c, &id, "worktree_cleaned",
            Some(&format!("{{\"path\":{},\"branch\":{}}}",
                json_escape(&path),
                json_escape(branch.as_deref().unwrap_or("")))))?;
        Ok(())
    })?;
    Ok(format!("워크트리 제거됨: {}", path))
}

// ─────────── helpers ───────────

fn rand_u32() -> u32 {
    // uuid v4 의 처음 32비트만 — 충돌 가능성 무시할 만큼 충분히 큼
    let id = uuid::Uuid::new_v4();
    let bytes = id.as_bytes();
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn json_escape(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}
