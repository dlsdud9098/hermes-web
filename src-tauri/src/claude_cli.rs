// Claude Code 인터랙티브 TUI 자동화 — Max 구독 풀로 동작 (claude -p 안 씀).
//
// 흐름:
//  1) `claude --session-id <uuid> --settings <tmp.json>` 를 PTY 안에서 spawn
//     --settings 안에 Stop 훅 등록 → 턴 완료 시 마커 파일 갱신
//  2) claude_send → PTY stdin 에 텍스트 + CR
//  3) 백그라운드 watcher 스레드가
//       (a) JSONL 파일을 200ms 마다 incremental tail — 새 라인이 보이면
//           assistant text 블록 → 'claude:delta', tool_use → 'claude:tool-start',
//           tool_result(user 메시지) → 'claude:tool-end' 로 이벤트 푸시
//       (b) 마커 파일 mtime 변화 → 'claude:turn-end' 푸시 (UI: streaming=false)
//
// TUI 출력은 ANSI 노이즈가 많아 파싱 안 함. Claude 표준 JSONL 을 단일 진실원천으로.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct ClaudeSessions(pub Mutex<HashMap<String, SessionHandle>>);

pub struct SessionHandle {
    pub session_id: String,
    pub jsonl_path: PathBuf,
    pub marker_path: PathBuf,
    pub settings_path: PathBuf,
    #[allow(dead_code)]
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub alive: Arc<Mutex<bool>>,
}

#[derive(Serialize, Clone)]
pub struct DeltaEvent {
    pub panel_id: String,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct ToolEvent {
    pub panel_id: String,
    pub tool: String,
    pub preview: String,
    pub id: String,
}

#[derive(Serialize, Clone)]
pub struct ToolEndEvent {
    pub panel_id: String,
    pub id: String,
    pub error: bool,
}

#[derive(Serialize, Clone)]
pub struct TurnEndEvent {
    pub panel_id: String,
}

#[derive(Serialize, Clone)]
pub struct PanelErrorEvent {
    pub panel_id: String,
    pub message: String,
}

/// cwd 를 Claude Code projects 디렉토리 인코딩 규칙으로 변환.
/// 예: /home/x/proj → -home-x-proj. 점은 그대로 유지.
fn encode_cwd(cwd: &str) -> String {
    cwd.replace(['/', '\\'], "-")
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())
}

fn tmp_dir() -> PathBuf {
    std::env::temp_dir()
}

fn write_settings_file(panel_id: &str, marker_path: &PathBuf) -> Result<PathBuf, String> {
    let settings_path = tmp_dir().join(format!("hermes-web-claude-settings-{}.json", panel_id));
    let cmd = format!("date +%s%3N > {}", marker_path.display());
    let json = serde_json::json!({
        "hooks": {
            "Stop": [{
                "matcher": "",
                "hooks": [{ "type": "command", "command": cmd }]
            }]
        }
    });
    fs::write(&settings_path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("settings 쓰기 실패: {}", e))?;
    Ok(settings_path)
}

/// JSONL incremental tail 으로 토큰(블록) 단위 스트리밍 이벤트 발생.
fn spawn_watcher(
    app: AppHandle,
    panel_id: String,
    jsonl_path: PathBuf,
    marker_path: PathBuf,
    alive: Arc<Mutex<bool>>,
) {
    thread::spawn(move || {
        let mut last_marker_mtime: Option<SystemTime> = None;
        let mut last_line_count: usize = 0;
        let mut last_jsonl_mtime: Option<SystemTime> = None;
        loop {
            if !*alive.lock().unwrap() {
                break;
            }
            thread::sleep(Duration::from_millis(200));

            // (a) JSONL incremental tail — mtime 바뀌면 새 라인만 emit
            if let Ok(meta) = fs::metadata(&jsonl_path) {
                if let Ok(mt) = meta.modified() {
                    if Some(mt) != last_jsonl_mtime {
                        last_jsonl_mtime = Some(mt);
                        if let Ok(text) = fs::read_to_string(&jsonl_path) {
                            let lines: Vec<&str> = text.lines().collect();
                            if lines.len() > last_line_count {
                                for line in &lines[last_line_count..] {
                                    emit_from_line(&app, &panel_id, line);
                                }
                                last_line_count = lines.len();
                            }
                        }
                    }
                }
            }

            // (b) Stop 훅 마커 → 턴 종료 신호
            if let Ok(meta) = fs::metadata(&marker_path) {
                if let Ok(mt) = meta.modified() {
                    if Some(mt) != last_marker_mtime {
                        last_marker_mtime = Some(mt);
                        let _ = app.emit(
                            "claude:turn-end",
                            TurnEndEvent { panel_id: panel_id.clone() },
                        );
                    }
                }
            }
        }
    });
}

fn emit_from_line(app: &AppHandle, panel_id: &str, line: &str) {
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

    if t == "assistant" {
        let Some(arr) = v.get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };
        for b in arr {
            match b.get("type").and_then(|x| x.as_str()) {
                Some("text") => {
                    if let Some(txt) = b.get("text").and_then(|x| x.as_str()) {
                        let _ = app.emit(
                            "claude:delta",
                            DeltaEvent {
                                panel_id: panel_id.to_string(),
                                text: txt.to_string(),
                            },
                        );
                    }
                }
                Some("tool_use") => {
                    let id = b.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let name = b.get("name").and_then(|x| x.as_str()).unwrap_or("?").to_string();
                    let input = b.get("input")
                        .map(|i| serde_json::to_string(i).unwrap_or_default())
                        .unwrap_or_default();
                    let preview: String = input.chars().take(120).collect();
                    let _ = app.emit(
                        "claude:tool-start",
                        ToolEvent {
                            panel_id: panel_id.to_string(),
                            tool: name,
                            preview,
                            id,
                        },
                    );
                }
                _ => {}
            }
        }
    } else if t == "user" {
        // tool_result 는 user 메시지의 content 배열 안에 들어옴
        let Some(arr) = v.get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };
        for b in arr {
            if b.get("type").and_then(|x| x.as_str()) == Some("tool_result") {
                let id = b.get("tool_use_id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let error = b.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
                let _ = app.emit(
                    "claude:tool-end",
                    ToolEndEvent {
                        panel_id: panel_id.to_string(),
                        id,
                        error,
                    },
                );
            }
        }
    }
}

#[tauri::command]
pub fn claude_start(
    app: AppHandle,
    state: State<'_, ClaudeSessions>,
    panel_id: String,
    cwd: String,
) -> Result<String, String> {
    {
        let map = state.0.lock().unwrap();
        if let Some(h) = map.get(&panel_id) {
            return Ok(h.session_id.clone());
        }
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let marker_path = tmp_dir().join(format!("hermes-web-claude-stop-{}.marker", panel_id));
    let _ = fs::remove_file(&marker_path);
    let settings_path = write_settings_file(&panel_id, &marker_path)?;

    let jsonl_path = home_dir()?
        .join(".claude")
        .join("projects")
        .join(encode_cwd(&cwd))
        .join(format!("{}.jsonl", session_id));

    let pty_sys = native_pty_system();
    let pair = pty_sys
        .openpty(PtySize { rows: 40, cols: 140, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("PTY open 실패: {}", e))?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(PathBuf::from(&cwd));
    cmd.arg("--session-id");
    cmd.arg(&session_id);
    cmd.arg("--settings");
    cmd.arg(settings_path.to_string_lossy().to_string());

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("claude 실행 실패: {}. PATH 와 로그인 상태 확인.", e))?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| format!("PTY writer: {}", e))?;
    let alive = Arc::new(Mutex::new(true));

    // PTY 출력 drain (블록 방지) — 내용은 안 씀
    {
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("PTY reader: {}", e))?;
        let alive_r = alive.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while *alive_r.lock().unwrap() {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
        });
    }

    spawn_watcher(
        app.clone(),
        panel_id.clone(),
        jsonl_path.clone(),
        marker_path.clone(),
        alive.clone(),
    );

    state.0.lock().unwrap().insert(
        panel_id,
        SessionHandle {
            session_id: session_id.clone(),
            jsonl_path,
            marker_path,
            settings_path,
            master,
            writer,
            child,
            alive,
        },
    );
    Ok(session_id)
}

#[tauri::command]
pub fn claude_send(
    state: State<'_, ClaudeSessions>,
    panel_id: String,
    text: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let h = map
        .get_mut(&panel_id)
        .ok_or_else(|| "세션 없음 — claude_start 먼저".to_string())?;
    h.writer
        .write_all(text.as_bytes())
        .map_err(|e| format!("PTY write: {}", e))?;
    thread::sleep(Duration::from_millis(50));
    h.writer
        .write_all(b"\r")
        .map_err(|e| format!("PTY CR: {}", e))?;
    h.writer.flush().ok();
    Ok(())
}

/// 자식 + 같은 프로세스 그룹 통째 kill — claude 가 띄운 도구 서브프로세스까지 정리.
fn kill_handle(h: &mut SessionHandle) {
    *h.alive.lock().unwrap() = false;

    // Unix: 프로세스 그룹 SIGKILL — PTY 가 setsid 로 분리해 같은 PGID 공유
    #[cfg(unix)]
    {
        if let Some(pid_u32) = h.child.process_id() {
            let pgid = pid_u32 as i32;
            // SIGTERM 먼저, 잠시 후 SIGKILL — 자식 + 손주까지 일괄
            unsafe { libc::kill(-pgid, libc::SIGTERM); }
            std::thread::sleep(Duration::from_millis(50));
            unsafe { libc::kill(-pgid, libc::SIGKILL); }
            let _ = h.child.wait();
        } else {
            let _ = h.child.kill();
        }
    }
    #[cfg(not(unix))]
    {
        let _ = h.child.kill();
    }

    let _ = fs::remove_file(&h.marker_path);
    let _ = fs::remove_file(&h.settings_path);
}

#[tauri::command]
pub fn claude_stop(
    state: State<'_, ClaudeSessions>,
    panel_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(mut h) = map.remove(&panel_id) {
        kill_handle(&mut h);
    }
    Ok(())
}

/// 모든 세션 종료 — UI 가 일괄 정리 요청 시(예: 앱 종료 직전)
#[tauri::command]
pub fn claude_stop_all(state: State<'_, ClaudeSessions>) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    for (_, mut h) in map.drain() {
        kill_handle(&mut h);
    }
    Ok(())
}

/// 창 destroy 이벤트에서 호출 — 비 Tauri::command 진입점
pub fn kill_all(state: &ClaudeSessions) {
    let mut map = state.0.lock().unwrap();
    for (_, mut h) in map.drain() {
        kill_handle(&mut h);
    }
}

/// 로그인/설치 상태 점검 — UI 시작 전 가드.
#[derive(Serialize)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub logged_in: bool,
    pub version: String,
    pub login_method: String,
}

#[tauri::command]
pub fn claude_check() -> Result<ClaudeStatus, String> {
    let version_out = match std::process::Command::new("claude").arg("--version").output() {
        Ok(o) => o,
        Err(_) => {
            return Ok(ClaudeStatus {
                installed: false,
                logged_in: false,
                version: String::new(),
                login_method: String::new(),
            });
        }
    };
    let version = String::from_utf8_lossy(&version_out.stdout).trim().to_string();

    let auth_out = std::process::Command::new("claude")
        .arg("auth")
        .arg("status")
        .arg("--text")
        .output();
    let (logged_in, login_method) = match auth_out {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            let logged = !text.is_empty()
                && !text.to_lowercase().contains("not logged in")
                && !text.to_lowercase().contains("no auth");
            let method = text
                .lines()
                .find(|l| l.to_lowercase().starts_with("login method"))
                .unwrap_or("")
                .splitn(2, ':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .to_string();
            (logged, method)
        }
        _ => (false, String::new()),
    };

    Ok(ClaudeStatus {
        installed: version_out.status.success(),
        logged_in,
        version,
        login_method,
    })
}

#[allow(dead_code)]
pub fn manage_state(app: &AppHandle) {
    app.manage(ClaudeSessions::default());
}

// ────────────────────── Max 구독 rate limit 조회 ──────────────────────
// `claude -p "ok" --output-format stream-json --verbose` 의 첫
// rate_limit_event 를 PTY 안에서 받아 파싱. Max 구독 한도 풀의 resetsAt
// 까지는 캐싱 — 5시간 윈도우 안에서 재호출 안 함 (구독 quota 절약).

#[derive(Serialize, Clone)]
pub struct ClaudeRateLimit {
    pub status: String,         // "allowed" | "exceeded" 등
    pub resets_at: u64,         // unix epoch (초)
    pub rate_limit_type: String,// "five_hour" 등
    pub is_using_overage: bool,
    pub checked_at_ms: u64,
}

#[derive(Default)]
pub struct RateLimitCache {
    pub inner: Mutex<Option<ClaudeRateLimit>>,
}

fn parse_rate_limit(text: &str) -> Option<ClaudeRateLimit> {
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v, Err(_) => continue,
        };
        if v.get("type").and_then(|x| x.as_str()) != Some("rate_limit_event") {
            continue;
        }
        let info = v.get("rate_limit_info")?;
        let status = info.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let resets_at = info.get("resetsAt").and_then(|x| x.as_u64()).unwrap_or(0);
        let rate_limit_type = info.get("rateLimitType")
            .and_then(|x| x.as_str()).unwrap_or("").to_string();
        let is_using_overage = info.get("isUsingOverage")
            .and_then(|x| x.as_bool()).unwrap_or(false);
        let checked_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64).unwrap_or(0);
        return Some(ClaudeRateLimit {
            status, resets_at, rate_limit_type, is_using_overage, checked_at_ms,
        });
    }
    None
}

fn query_rate_limit() -> Result<ClaudeRateLimit, String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::time::Instant;

    let pty = native_pty_system();
    let pair = pty.openpty(PtySize {
        rows: 40, cols: 140, pixel_width: 0, pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.arg("-p");
    cmd.arg("ok");
    cmd.arg("--output-format");
    cmd.arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--include-partial-messages");

    let mut child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("claude spawn 실패: {}", e))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()
        .map_err(|e| e.to_string())?;
    let mut buf: Vec<u8> = Vec::new();
    let start = Instant::now();
    let mut tmp = [0u8; 4096];

    let result: Result<ClaudeRateLimit, String> = loop {
        if start.elapsed() > Duration::from_secs(15) {
            break Err("rate_limit 조회 타임아웃".into());
        }
        match reader.read(&mut tmp) {
            Ok(0) => {
                let text = String::from_utf8_lossy(&buf);
                if let Some(rl) = parse_rate_limit(&text) { break Ok(rl); }
                break Err("rate_limit_event 미발견".into());
            }
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                let text = String::from_utf8_lossy(&buf);
                if let Some(rl) = parse_rate_limit(&text) { break Ok(rl); }
            }
            Err(e) => break Err(format!("PTY read: {}", e)),
        }
    };

    let _ = child.kill();
    let _ = child.wait();
    result
}

#[tauri::command]
pub fn claude_rate_limit(
    state: tauri::State<'_, RateLimitCache>,
    force: bool,
) -> Result<Option<ClaudeRateLimit>, String> {
    let now_s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if !force {
        let cache = state.inner.lock().unwrap();
        if let Some(rl) = cache.as_ref() {
            if rl.resets_at > now_s {
                return Ok(Some(rl.clone()));
            }
        }
    }
    match query_rate_limit() {
        Ok(rl) => {
            *state.inner.lock().unwrap() = Some(rl.clone());
            Ok(Some(rl))
        }
        Err(_) => Ok(None),
    }
}
