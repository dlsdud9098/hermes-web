// Claude Code 인터랙티브 TUI 자동화 — Max 구독 풀로 동작 (claude -p 가 아닌 진짜 TUI).
//
// 흐름:
//  1) `claude --session-id <uuid> --settings <tmp.json>` 를 PTY 안에서 spawn
//     - --settings 파일에 Stop 훅 등록 → 턴 완료 시 마커 파일 생성
//  2) 사용자 프롬프트가 들어오면 PTY stdin 에 텍스트 + CR 전송
//  3) 별도 스레드가 마커 파일을 polling — 새 마커 보이면 Claude 의 표준 JSONL
//     (~/.claude/projects/<encoded-cwd>/<session-id>.jsonl) 의 새 줄들을 파싱
//     → 정규화된 텍스트로 Tauri 이벤트 'claude:turn' 푸시
//  4) panel 닫히면 stop → 프로세스 kill + 임시파일 정리
//
// TUI 출력은 ANSI/애니메이션 노이즈가 많아 직접 파싱하지 않는다.
// 대신 Claude 가 자체 보관하는 JSONL 을 단일 진실원천으로 사용 — SessionViewer 와 동일 포맷.

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
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    /// 마지막으로 emit 한 JSONL 라인 수
    pub last_emitted_lines: Arc<Mutex<usize>>,
    pub alive: Arc<Mutex<bool>>,
}

#[derive(Serialize, Clone)]
pub struct ClaudeTurnEvent {
    pub panel_id: String,
    pub text: String,
    pub tools: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ClaudeErrorEvent {
    pub panel_id: String,
    pub message: String,
}

/// cwd 를 Claude Code 의 projects 디렉토리 인코딩 규칙으로 변환
/// 예: /home/x/proj → -home-x-proj
fn encode_cwd(cwd: &str) -> String {
    cwd.replace(['/', '\\'], "-")
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())
}

fn tmp_dir() -> PathBuf {
    std::env::temp_dir()
}

/// Stop 훅 1개 등록 — 턴 완료 시 마커 파일에 epoch 시간 기록.
fn write_settings_file(panel_id: &str, marker_path: &PathBuf) -> Result<PathBuf, String> {
    let settings_path = tmp_dir().join(format!("hermes-web-claude-settings-{}.json", panel_id));
    // 셸 escape — 경로에 특수문자 없다는 전제(우리가 생성). 그래도 안전하게 따옴표.
    let cmd = format!("date +%s%3N > {}", marker_path.display());
    let json = serde_json::json!({
        "hooks": {
            "Stop": [{
                "matcher": "",
                "hooks": [{
                    "type": "command",
                    "command": cmd
                }]
            }]
        }
    });
    fs::write(&settings_path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("settings 파일 쓰기 실패: {}", e))?;
    Ok(settings_path)
}

/// 백그라운드: 마커 파일 변경 감시 → 새 JSONL 라인을 파싱해서 이벤트 푸시.
fn spawn_watcher(
    app: AppHandle,
    panel_id: String,
    jsonl_path: PathBuf,
    marker_path: PathBuf,
    last_emitted: Arc<Mutex<usize>>,
    alive: Arc<Mutex<bool>>,
) {
    thread::spawn(move || {
        let mut last_marker_mtime: Option<SystemTime> = None;
        loop {
            if !*alive.lock().unwrap() {
                break;
            }
            thread::sleep(Duration::from_millis(250));
            let mtime = match fs::metadata(&marker_path).and_then(|m| m.modified()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if Some(mtime) == last_marker_mtime {
                continue;
            }
            last_marker_mtime = Some(mtime);

            // 마커가 갱신됨 → JSONL tail 읽어서 새 메시지 추출
            let lines = match fs::read_to_string(&jsonl_path) {
                Ok(s) => s,
                Err(_) => continue, // 아직 안 만들어진 첫 턴 직전
            };
            let lines: Vec<&str> = lines.lines().collect();
            let mut prev = last_emitted.lock().unwrap();
            if lines.len() <= *prev {
                continue;
            }
            let new_slice = &lines[*prev..];
            let (text, tools) = collect_assistant(new_slice);
            *prev = lines.len();
            drop(prev);
            if text.trim().is_empty() && tools.is_empty() {
                continue;
            }
            let _ = app.emit(
                "claude:turn",
                ClaudeTurnEvent {
                    panel_id: panel_id.clone(),
                    text,
                    tools,
                },
            );
        }
    });
}

/// 새 JSONL 라인들에서 assistant 텍스트와 사용된 툴 이름을 추출
fn collect_assistant(lines: &[&str]) -> (String, Vec<String>) {
    let mut text_parts: Vec<String> = Vec::new();
    let mut tools: Vec<String> = Vec::new();
    for line in lines {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|x| x.as_str()) != Some("assistant") {
            continue;
        }
        let content = v
            .get("message")
            .and_then(|m| m.get("content"));
        let Some(arr) = content.and_then(|c| c.as_array()) else {
            continue;
        };
        for b in arr {
            match b.get("type").and_then(|x| x.as_str()) {
                Some("text") => {
                    if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                        text_parts.push(t.to_string());
                    }
                }
                Some("tool_use") => {
                    if let Some(n) = b.get("name").and_then(|x| x.as_str()) {
                        tools.push(n.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    (text_parts.join("\n"), tools)
}

#[tauri::command]
pub fn claude_start(
    app: AppHandle,
    state: State<'_, ClaudeSessions>,
    panel_id: String,
    cwd: String,
) -> Result<String, String> {
    // 이미 있으면 그대로 사용
    {
        let map = state.0.lock().unwrap();
        if let Some(h) = map.get(&panel_id) {
            return Ok(h.session_id.clone());
        }
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let marker_path = tmp_dir().join(format!("hermes-web-claude-stop-{}.marker", panel_id));
    let _ = fs::remove_file(&marker_path); // 잔존 제거
    let settings_path = write_settings_file(&panel_id, &marker_path)?;

    let jsonl_path = home_dir()?
        .join(".claude")
        .join("projects")
        .join(encode_cwd(&cwd))
        .join(format!("{}.jsonl", session_id));

    // PTY spawn
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
    // 첫 실행 다이얼로그 자동 통과는 안 함 — 사용자가 한번 `claude` 실행해서 설정 완료 전제

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("claude 실행 실패: {}. 설치/로그인 확인 필요.", e))?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| format!("PTY writer: {}", e))?;
    let alive = Arc::new(Mutex::new(true));
    let last_emitted = Arc::new(Mutex::new(0usize));

    // PTY 출력은 버려도 무방하지만 버퍼 차지 안 하게 drain 스레드 띄움
    {
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("PTY reader clone: {}", e))?;
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
        last_emitted.clone(),
        alive.clone(),
    );

    let handle = SessionHandle {
        session_id: session_id.clone(),
        jsonl_path,
        marker_path,
        settings_path,
        master,
        writer,
        child,
        last_emitted_lines: last_emitted,
        alive,
    };

    state.0.lock().unwrap().insert(panel_id, handle);
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
    // 프롬프트 입력 + 캐리지 리턴 (TUI 가 Enter 로 인식)
    h.writer
        .write_all(text.as_bytes())
        .map_err(|e| format!("PTY write: {}", e))?;
    thread::sleep(Duration::from_millis(50));
    h.writer
        .write_all(b"\r")
        .map_err(|e| format!("PTY write CR: {}", e))?;
    h.writer.flush().ok();
    Ok(())
}

#[tauri::command]
pub fn claude_stop(
    state: State<'_, ClaudeSessions>,
    panel_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(mut h) = map.remove(&panel_id) {
        *h.alive.lock().unwrap() = false;
        let _ = h.child.kill();
        let _ = fs::remove_file(&h.marker_path);
        let _ = fs::remove_file(&h.settings_path);
    }
    Ok(())
}

/// 앱 시작 시 호출 — Claude Code 가 설치/로그인 되어 있는지 확인.
#[tauri::command]
pub fn claude_check() -> Result<bool, String> {
    let out = std::process::Command::new("claude")
        .arg("--version")
        .output()
        .map_err(|e| format!("claude 명령 찾을 수 없음: {}", e))?;
    Ok(out.status.success())
}

pub fn manage_state(app: &AppHandle) {
    app.manage(ClaudeSessions::default());
}
