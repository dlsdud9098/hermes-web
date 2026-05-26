// Codex CLI 백엔드 — `codex exec --json` 비대화 모드.
//
// 흐름:
//  1) 매 턴마다 `codex exec [resume <thread_id>] --json --skip-git-repo-check -C <cwd>`
//     를 spawn. 첫 턴이면 resume 없음.
//  2) 프롬프트를 stdin 으로 전달 (특수문자/긴 입력 안전).
//  3) stdout 라인 = NDJSON 이벤트 — thread.started/turn.started/item.completed/turn.completed.
//  4) 이벤트 파싱 → Tauri emit:
//       codex:delta      (agent_message text)
//       codex:tool-start (function_call / tool_use)
//       codex:tool-end   (tool_result)
//       codex:turn-end   (usage)
//  5) 프로세스 자연 종료 = 턴 끝.
//
// 인증: ChatGPT Plus/Pro 구독. 사전 `codex login` 필요. OpenAI 가 공식 지원.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct CodexSessions(pub Mutex<HashMap<String, SessionState>>);

#[derive(Default, Clone)]
pub struct SessionState {
    /// codex 가 부여한 thread_id — resume 키
    pub thread_id: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct CodexDelta { pub panel_id: String, pub text: String }
#[derive(Serialize, Clone)]
pub struct CodexToolStart {
    pub panel_id: String, pub tool: String, pub preview: String, pub id: String,
}
#[derive(Serialize, Clone)]
pub struct CodexToolEnd {
    pub panel_id: String, pub id: String, pub error: bool,
}
#[derive(Serialize, Clone)]
pub struct CodexTurnEnd {
    pub panel_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}
#[derive(Serialize, Clone)]
pub struct CodexErrorEvent {
    pub panel_id: String, pub message: String,
}

#[tauri::command]
pub fn codex_check() -> Result<bool, String> {
    let out = Command::new("codex").arg("--version").output();
    match out {
        Ok(o) => Ok(o.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn codex_login_status() -> Result<String, String> {
    let out = Command::new("codex").arg("login").arg("status")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub fn codex_send(
    app: AppHandle,
    state: State<'_, CodexSessions>,
    panel_id: String,
    cwd: String,
    text: String,
) -> Result<(), String> {
    // 기존 thread_id (있으면 resume)
    let thread_id = {
        let map = state.0.lock().unwrap();
        map.get(&panel_id).and_then(|s| s.thread_id.clone())
    };

    let mut cmd = Command::new("codex");
    cmd.arg("exec");
    if let Some(tid) = &thread_id {
        cmd.arg("resume").arg(tid);
    }
    cmd.arg("--json")
       .arg("--skip-git-repo-check")
       .arg("-C").arg(&cwd)
       .stdin(Stdio::piped())
       .stdout(Stdio::piped())
       .stderr(Stdio::null());

    let mut child = cmd.spawn()
        .map_err(|e| format!("codex 실행 실패: {}. PATH 와 'codex login' 확인.", e))?;

    // 프롬프트 stdin 전달
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes())
            .map_err(|e| format!("codex stdin: {}", e))?;
        // drop → EOF → codex 가 입력 종료로 인식
    }

    let stdout = child.stdout.take().ok_or("codex stdout 없음")?;

    // 워치 스레드 — 라인별 파싱 + 이벤트 emit
    {
        let panel = panel_id.clone();
        let app_h = app.clone();
        let sessions_arc = state.inner();
        // State 자체는 Send + 'static 이지만 thread 로 옮기려면 별도 핸들 필요.
        // 대신 thread_id 업데이트는 app handle 의 try_state 로 재취득.
        let _ = sessions_arc; // suppress
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut input_tokens: u64 = 0;
            let mut output_tokens: u64 = 0;
            for line in reader.lines().flatten() {
                let v: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v, Err(_) => continue,
                };
                let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
                match t {
                    "thread.started" => {
                        if let Some(tid) = v.get("thread_id").and_then(|x| x.as_str()) {
                            let app2 = app_h.clone();
                            if let Some(sessions) = app2.try_state::<CodexSessions>() {
                                let mut map = sessions.0.lock().unwrap();
                                map.entry(panel.clone()).or_default().thread_id = Some(tid.to_string());
                            }
                        }
                    }
                    "item.completed" => {
                        let item = match v.get("item") { Some(i) => i, None => continue };
                        let item_type = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
                        match item_type {
                            "agent_message" => {
                                if let Some(text) = item.get("text").and_then(|x| x.as_str()) {
                                    let _ = app_h.emit("codex:delta", CodexDelta {
                                        panel_id: panel.clone(),
                                        text: text.to_string(),
                                    });
                                }
                            }
                            "function_call" | "tool_use" => {
                                let id = item.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                                let name = item.get("name")
                                    .or_else(|| item.get("function").and_then(|f| f.get("name")))
                                    .and_then(|x| x.as_str()).unwrap_or("?").to_string();
                                let preview = item.get("arguments")
                                    .or_else(|| item.get("input"))
                                    .map(|x| x.to_string()).unwrap_or_default();
                                let preview: String = preview.chars().take(120).collect();
                                let _ = app_h.emit("codex:tool-start", CodexToolStart {
                                    panel_id: panel.clone(), tool: name, preview, id,
                                });
                            }
                            "function_call_output" | "tool_result" => {
                                let id = item.get("call_id")
                                    .or_else(|| item.get("id"))
                                    .and_then(|x| x.as_str()).unwrap_or("").to_string();
                                let error = item.get("error").is_some()
                                    || item.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
                                let _ = app_h.emit("codex:tool-end", CodexToolEnd {
                                    panel_id: panel.clone(), id, error,
                                });
                            }
                            "error" => {
                                if let Some(msg) = item.get("message").and_then(|x| x.as_str()) {
                                    // 에이전트 정의 파싱 에러 등 noise 는 무시
                                    if !msg.contains("Ignoring malformed") {
                                        let _ = app_h.emit("codex:error", CodexErrorEvent {
                                            panel_id: panel.clone(),
                                            message: msg.to_string(),
                                        });
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    "turn.completed" => {
                        if let Some(u) = v.get("usage") {
                            input_tokens = u.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                            output_tokens = u.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                        }
                    }
                    _ => {}
                }
            }
            let _ = child.wait();
            let _ = app_h.emit("codex:turn-end", CodexTurnEnd {
                panel_id: panel, input_tokens, output_tokens,
            });
        });
    }

    Ok(())
}

#[tauri::command]
pub fn codex_clear_session(
    state: State<'_, CodexSessions>,
    panel_id: String,
) -> Result<(), String> {
    state.0.lock().unwrap().remove(&panel_id);
    Ok(())
}
