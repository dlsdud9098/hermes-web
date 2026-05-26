// 외부 코딩 에이전트(Claude Code / Codex)의 로컬 대화 기록 조회.
//   - Claude Code: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
//   - Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// 레코드 포맷이 서로 다르므로 source 별로 파싱 → 공통 SessionMsg 로 정규화한다.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct SessionMeta {
    pub source: String,
    pub id: String,
    pub file: String,
    pub cwd: Option<String>,
    /// 첫 user 발화 일부 (~120자) 또는 파일명
    pub title: String,
    /// 최근 수정 시각 (epoch ms)
    pub modified_ms: u64,
    /// 파일 크기 (bytes)
    pub size: u64,
}

#[derive(Serialize)]
pub struct SessionMsg {
    pub role: String,
    pub text: String,
    pub timestamp: Option<String>,
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())
}

fn modified_ms_and_size(path: &Path) -> (u64, u64) {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    let ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    (ms, meta.len())
}

/// 파일 머리부분만(첫 N 라인) 파싱 — 제목/cwd 추출용. 전체 라인 카운트는 안 함(IO 절약).
fn scan_head<F>(path: &Path, max_lines: usize, mut on_record: F)
    -> (Option<String>, Option<String>)
where
    F: FnMut(&Value) -> (Option<String>, Option<String>),
{
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, None),
    };
    let reader = BufReader::new(file);
    let mut title: Option<String> = None;
    let mut cwd: Option<String> = None;
    for line in reader.lines().take(max_lines).flatten() {
        if title.is_some() && cwd.is_some() {
            break;
        }
        let val: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let (t, c) = on_record(&val);
        if title.is_none() {
            title = t;
        }
        if cwd.is_none() {
            cwd = c;
        }
    }
    (title, cwd)
}

fn truncate(s: &str, max: usize) -> String {
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= max {
            out.push('…');
            break;
        }
        if ch == '\n' || ch == '\r' {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out.trim().to_string()
}

/// content 필드(문자열 또는 [{type:'text',text:'...'}] 블록 배열)에서 텍스트만 추출.
fn extract_text(content: &Value) -> Option<String> {
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut parts: Vec<String> = Vec::new();
        for b in arr {
            if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                parts.push(t.to_string());
            } else if let Some(t) = b.get("input_text").and_then(|v| v.as_str()) {
                parts.push(t.to_string());
            } else if b.get("type").and_then(|v| v.as_str()) == Some("input_text") {
                if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                    parts.push(t.to_string());
                }
            } else if b.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                parts.push(format!("[tool: {}]", name));
            } else if b.get("type").and_then(|v| v.as_str()) == Some("tool_result") {
                let txt = b.get("content").and_then(|v| {
                    if let Some(s) = v.as_str() { Some(s.to_string()) }
                    else { extract_text(v) }
                }).unwrap_or_default();
                parts.push(format!("[tool_result] {}", txt));
            } else if b.get("type").and_then(|v| v.as_str()) == Some("thinking") {
                // 사고는 표시 안 함 (너무 김)
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

// ────────────────────── Claude Code ──────────────────────

fn list_claude(out: &mut Vec<SessionMeta>) -> Result<(), String> {
    let root = home()?.join(".claude").join("projects");
    let proj_dirs = match fs::read_dir(&root) {
        Ok(d) => d,
        Err(_) => return Ok(()), // 디렉토리 없음 — 빈 목록
    };
    for proj in proj_dirs.flatten() {
        let proj_path = proj.path();
        if !proj_path.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&proj_path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let id = p.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let (title, cwd) = scan_head(&p, 100, |v| {
                let mut t = None;
                let mut c = None;
                if v.get("type").and_then(|x| x.as_str()) == Some("user") {
                    if let Some(msg) = v.get("message") {
                        if let Some(content) = msg.get("content") {
                            if let Some(s) = extract_text(content) {
                                t = Some(truncate(&s, 120));
                            }
                        }
                    }
                }
                if let Some(s) = v.get("cwd").and_then(|x| x.as_str()) {
                    c = Some(s.to_string());
                }
                (t, c)
            });
            let (m, sz) = modified_ms_and_size(&p);
            out.push(SessionMeta {
                source: "claude".into(),
                id,
                file: p.to_string_lossy().to_string(),
                cwd,
                title: title.unwrap_or_else(|| "(빈 세션)".into()),
                modified_ms: m,
                size: sz,
            });
        }
    }
    Ok(())
}

fn load_claude(path: &Path) -> Result<Vec<SessionMsg>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut msgs: Vec<SessionMsg> = Vec::new();
    for line in reader.lines().flatten() {
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let role = match t {
            "user" => "user",
            "assistant" => "assistant",
            "system" => "system",
            _ => continue,
        };
        let text = v.get("message")
            .and_then(|m| m.get("content"))
            .and_then(extract_text)
            .unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        let timestamp = v.get("timestamp").and_then(|x| x.as_str()).map(String::from);
        msgs.push(SessionMsg { role: role.into(), text, timestamp });
    }
    Ok(msgs)
}

// ────────────────────── Codex ──────────────────────

fn walk_codex(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 5 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for e in entries.flatten() {
        let p = e.path();
        let ft = match e.file_type() {
            Ok(f) => f,
            Err(_) => continue,
        };
        if ft.is_dir() {
            walk_codex(&p, depth + 1, out);
        } else if ft.is_file()
            && p.extension().and_then(|x| x.to_str()) == Some("jsonl")
        {
            out.push(p);
        }
    }
}

fn list_codex(out: &mut Vec<SessionMeta>) -> Result<(), String> {
    let root = home()?.join(".codex").join("sessions");
    if !root.exists() {
        return Ok(());
    }
    let mut files: Vec<PathBuf> = Vec::new();
    walk_codex(&root, 0, &mut files);
    for p in files {
        let id = p.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let (title, cwd) = scan_head(&p, 100, |v| {
            let mut t = None;
            let mut c = None;
            // response_item.payload.role == 'user' 의 첫 텍스트
            if v.get("type").and_then(|x| x.as_str()) == Some("response_item") {
                if let Some(p) = v.get("payload") {
                    if p.get("role").and_then(|x| x.as_str()) == Some("user") {
                        if let Some(content) = p.get("content") {
                            if let Some(s) = extract_text(content) {
                                // 시스템 주입 메시지(AGENTS.md 등) 건너뜀
                                if !s.starts_with("# AGENTS.md")
                                    && !s.starts_with("<permissions")
                                    && !s.starts_with("<user_instructions")
                                {
                                    t = Some(truncate(&s, 120));
                                }
                            }
                        }
                    }
                }
            }
            // session_meta.payload.cwd 또는 turn_context.payload.cwd
            if let Some(pl) = v.get("payload") {
                if let Some(s) = pl.get("cwd").and_then(|x| x.as_str()) {
                    c = Some(s.to_string());
                }
            }
            (t, c)
        });
        let (m, sz) = modified_ms_and_size(&p);
        out.push(SessionMeta {
            source: "codex".into(),
            id,
            file: p.to_string_lossy().to_string(),
            cwd,
            title: title.unwrap_or_else(|| "(빈 세션)".into()),
            modified_ms: m,
            size: sz,
        });
    }
    Ok(())
}

fn load_codex(path: &Path) -> Result<Vec<SessionMsg>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut msgs: Vec<SessionMsg> = Vec::new();
    for line in reader.lines().flatten() {
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|x| x.as_str()) != Some("response_item") {
            continue;
        }
        let payload = match v.get("payload") {
            Some(p) => p,
            None => continue,
        };
        let role = payload.get("role").and_then(|x| x.as_str()).unwrap_or("");
        let role = match role {
            "user" => "user",
            "assistant" => "assistant",
            "system" | "developer" => "system",
            _ => continue,
        };
        let text = payload
            .get("content")
            .and_then(extract_text)
            .unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        let timestamp = v.get("timestamp").and_then(|x| x.as_str()).map(String::from);
        msgs.push(SessionMsg { role: role.into(), text, timestamp });
    }
    Ok(msgs)
}

// ────────────────────── Tauri commands ──────────────────────

#[tauri::command]
pub fn sessions_list(source: String) -> Result<Vec<SessionMeta>, String> {
    let mut out: Vec<SessionMeta> = Vec::new();
    match source.as_str() {
        "claude" => list_claude(&mut out)?,
        "codex" => list_codex(&mut out)?,
        "all" => {
            list_claude(&mut out)?;
            list_codex(&mut out)?;
        }
        other => return Err(format!("알 수 없는 source: {}", other)),
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

#[tauri::command]
pub fn session_load(source: String, file: String) -> Result<Vec<SessionMsg>, String> {
    let p = PathBuf::from(file);
    match source.as_str() {
        "claude" => load_claude(&p),
        "codex" => load_codex(&p),
        other => Err(format!("알 수 없는 source: {}", other)),
    }
}
