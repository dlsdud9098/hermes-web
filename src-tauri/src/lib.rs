// Hermes Web — Tauri 백엔드.
// fs_* 커맨드는 기존 vite dev 미들웨어(/fs/list, /fs/read, /fs/write, /fs/skills)와
// 같은 시맨틱. 프론트엔드는 Tauri 환경에서만 invoke 로 호출.
// Hermes 게이트웨이(HTTP/SSE) 는 별도 tauri-plugin-http 로 직접 호출 (CORS 우회).

mod accounts;
mod browser;
mod claude_cli;
mod codex_cli;
mod fs_walk;
mod search;
mod sessions;
mod usage;

use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct DirListing {
    path: String,
    parent: Option<String>,
    dirs: Vec<DirEntry>,
    files: Vec<DirEntry>,
}

#[derive(Serialize)]
struct FileContent {
    path: String,
    content: String,
    truncated: bool,
}

#[derive(Serialize, Clone)]
struct Skill {
    name: String,
    description: String,
}

/// 디렉토리 목록 — 숨김 포함, 이름순 정렬. path 생략 시 홈 디렉토리.
#[tauri::command]
fn fs_list(path: Option<String>) -> Result<DirListing, String> {
    let dir: PathBuf = match path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())?,
    };
    let abs = fs::canonicalize(&dir).unwrap_or(dir.clone());
    let entries = fs::read_dir(&abs).map_err(|e| e.to_string())?;

    let mut dirs_out: Vec<DirEntry> = Vec::new();
    let mut files_out: Vec<DirEntry> = Vec::new();

    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path().to_string_lossy().to_string();
        let ft = match e.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_dir() {
            dirs_out.push(DirEntry { name, path: p });
        } else if ft.is_file() {
            files_out.push(DirEntry { name, path: p });
        }
    }
    dirs_out.sort_by(|a, b| a.name.cmp(&b.name));
    files_out.sort_by(|a, b| a.name.cmp(&b.name));

    let parent = abs.parent().map(|p| p.to_string_lossy().to_string());
    let parent = match (&parent, abs.to_string_lossy().to_string()) {
        (Some(p), abs_str) if *p == abs_str => None,
        (Some(p), _) => Some(p.clone()),
        _ => None,
    };

    Ok(DirListing {
        path: abs.to_string_lossy().to_string(),
        parent,
        dirs: dirs_out,
        files: files_out,
    })
}

/// 파일 읽기 — 최대 256KB.
#[tauri::command]
fn fs_read(path: String) -> Result<FileContent, String> {
    // 50MB — 사실상 어떤 텍스트 파일도 다 읽힘 (50MB 이상 = 데이터덤프, 별도 도구 권장).
    const MAX: u64 = 50 * 1024 * 1024;
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아님".to_string());
    }
    let size = meta.len();
    let read_len = std::cmp::min(size, MAX) as usize;
    let mut file = fs::File::open(&p).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; read_len];
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&buf).to_string();
    Ok(FileContent {
        path: p.to_string_lossy().to_string(),
        content,
        truncated: size > MAX,
    })
}

/// 파일 쓰기 (UTF-8 덮어쓰기)
#[tauri::command]
fn fs_write(path: String, content: String) -> Result<(), String> {
    fs::write(PathBuf::from(path), content).map_err(|e| e.to_string())
}

// ─────────── 파일 트리 컨텍스트 메뉴 작업 ───────────

/// 재귀 복사 — 파일 또는 디렉토리. dst 가 존재하면 에러.
fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    let meta = fs::metadata(src)?;
    if meta.is_dir() {
        fs::create_dir(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let from = entry.path();
            let to = dst.join(entry.file_name());
            copy_recursive(&from, &to)?;
        }
    } else {
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// 중복 시 ' (1)' / ' (2)' 식으로 고유 경로 만들기
fn unique_path(target: &Path) -> PathBuf {
    if !target.exists() { return target.to_path_buf(); }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("copy").to_string();
    let ext = target.extension().and_then(|s| s.to_str()).unwrap_or("");
    let mut n = 1;
    loop {
        let name = if ext.is_empty() {
            format!("{} ({})", stem, n)
        } else {
            format!("{} ({}).{}", stem, n, ext)
        };
        let p = parent.join(name);
        if !p.exists() { return p; }
        n += 1;
    }
}

#[tauri::command]
fn fs_copy(src: String, dst_dir: String) -> Result<String, String> {
    let src_p = PathBuf::from(&src);
    let name = src_p.file_name().ok_or("src 파일명 없음".to_string())?;
    let target = PathBuf::from(&dst_dir).join(name);
    let final_target = unique_path(&target);
    copy_recursive(&src_p, &final_target).map_err(|e| format!("copy: {}", e))?;
    Ok(final_target.to_string_lossy().to_string())
}

#[tauri::command]
fn fs_move(src: String, dst_dir: String) -> Result<String, String> {
    let src_p = PathBuf::from(&src);
    let name = src_p.file_name().ok_or("src 파일명 없음".to_string())?;
    let target = PathBuf::from(&dst_dir).join(name);
    let final_target = unique_path(&target);
    fs::rename(&src_p, &final_target).map_err(|e| format!("move: {}", e))?;
    Ok(final_target.to_string_lossy().to_string())
}

#[tauri::command]
fn fs_rename(src: String, new_name: String) -> Result<String, String> {
    let src_p = PathBuf::from(&src);
    let parent = src_p.parent().ok_or("부모 폴더 없음".to_string())?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("이미 존재: {}", new_name));
    }
    fs::rename(&src_p, &new_path).map_err(|e| format!("rename: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn fs_delete(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() { return Ok(()); }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("delete dir: {}", e))?;
    } else {
        fs::remove_file(&p).map_err(|e| format!("delete file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn fs_mkdir(parent: String, name: String) -> Result<String, String> {
    let p = PathBuf::from(&parent).join(&name);
    if p.exists() { return Err(format!("이미 존재: {}", name)); }
    fs::create_dir_all(&p).map_err(|e| format!("mkdir: {}", e))?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn fs_new_file(parent: String, name: String) -> Result<String, String> {
    let p = PathBuf::from(&parent).join(&name);
    if p.exists() { return Err(format!("이미 존재: {}", name)); }
    fs::write(&p, "").map_err(|e| format!("new file: {}", e))?;
    Ok(p.to_string_lossy().to_string())
}

/// SKILL.md YAML 프론트매터에서 name/description 추출
fn parse_skill_md(file: &Path, fallback: &str) -> Skill {
    let text = fs::read_to_string(file).unwrap_or_default();
    let head: String = text.chars().take(4000).collect();
    let mut name = fallback.to_string();
    let mut description = String::new();
    if let Some(rest) = head.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let fm = &rest[..end];
            for line in fm.lines() {
                let line = line.trim();
                if let Some(v) = line.strip_prefix("name:") {
                    name = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                } else if let Some(v) = line.strip_prefix("description:") {
                    description = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                }
            }
        }
    }
    // Hermes 슬래시 슬러그 규칙
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let slug = slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    Skill { name: slug, description }
}

fn walk_skills(root: &Path, depth: u32, out: &mut Vec<Skill>) {
    if depth > 3 {
        return;
    }
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    let entries: Vec<_> = entries.flatten().collect();
    // SKILL.md 가 있으면 이 디렉토리가 스킬 루트 — 더 안 내려간다
    let skill_md = entries.iter().find(|e| e.file_name() == "SKILL.md");
    if let Some(md) = skill_md {
        let fallback = root.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(parse_skill_md(&md.path(), &fallback));
        return;
    }
    for e in entries {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let ft = match e.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_dir() {
            walk_skills(&e.path(), depth + 1, out);
        }
    }
}

#[derive(Serialize)]
struct SkillList {
    skills: Vec<Skill>,
}

#[tauri::command]
fn fs_skills() -> Result<SkillList, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())?;
    let root = home.join(".hermes").join("skills");
    let mut out: Vec<Skill> = Vec::new();
    walk_skills(&root, 0, &mut out);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(SkillList { skills: out })
}

/// 마크다운 1개 파일을 명령 1개로 — 파일명(stem) = 슬래시명, 첫 줄(#/제목)이나
/// 프론트매터 description 을 설명으로.
fn parse_command_md(file: &Path) -> Skill {
    let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let mut description = String::new();
    if let Ok(text) = fs::read_to_string(file) {
        let head: String = text.chars().take(2000).collect();
        // YAML frontmatter description 우선
        if let Some(rest) = head.strip_prefix("---") {
            if let Some(end) = rest.find("\n---") {
                for line in rest[..end].lines() {
                    if let Some(v) = line.trim().strip_prefix("description:") {
                        description = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                        break;
                    }
                }
            }
        }
        // 없으면 첫 비어있지 않은 라인 (제목 또는 한 줄 요약)
        if description.is_empty() {
            for line in head.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("---") { continue; }
                description = line.trim_start_matches('#').trim().to_string();
                break;
            }
        }
    }
    Skill { name: stem.to_lowercase().replace('_', "-"), description }
}

fn walk_commands_dir(root: &Path, out: &mut Vec<Skill>) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e, Err(_) => return,
    };
    for e in entries.flatten() {
        let path = e.path();
        let ft = match e.file_type() { Ok(ft) => ft, Err(_) => continue };
        if ft.is_dir() {
            walk_commands_dir(&path, out);
        } else if ft.is_file()
            && path.extension().and_then(|x| x.to_str()) == Some("md")
        {
            out.push(parse_command_md(&path));
        }
    }
}

/// Claude Code builtin slash commands (필터될 일 없는 핵심만)
fn builtin_claude_commands() -> Vec<Skill> {
    let items = [
        ("usage", "현재 세션 토큰 사용량 + 플랜 한도 표시"),
        ("status", "세션 설정 + 토큰 사용량 한 줄 요약"),
        ("clear", "현재 세션 히스토리 비우기"),
        ("compact", "히스토리 요약·압축"),
        ("model", "이번 세션 모델 변경"),
        ("review", "코드 리뷰 모드"),
        ("resume", "이전 세션 재개 (picker)"),
        ("memory", "메모리 편집"),
        ("agents", "에이전트 관리"),
        ("plugins", "플러그인 관리"),
        ("init", "프로젝트 초기화"),
        ("doctor", "claude 설치 헬스체크"),
    ];
    items.into_iter().map(|(n, d)| Skill { name: n.into(), description: d.into() }).collect()
}

/// Codex builtin slash commands
fn builtin_codex_commands() -> Vec<Skill> {
    let items = [
        ("status", "thread id, context 사용량, rate limit 표시"),
        ("plan", "plan 모드 토글 (다단계 계획)"),
        ("review", "코드 리뷰 모드 (변경분 vs base)"),
        ("goal", "지속 목표 설정"),
        ("mcp", "연결된 MCP 서버 상태"),
        ("feedback", "피드백 다이얼로그"),
    ];
    items.into_iter().map(|(n, d)| Skill { name: n.into(), description: d.into() }).collect()
}

#[tauri::command]
fn provider_skills(source: String) -> Result<SkillList, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())?;
    let mut out: Vec<Skill> = Vec::new();
    match source.as_str() {
        "hermes" => {
            walk_skills(&home.join(".hermes").join("skills"), 0, &mut out);
        }
        "claude" => {
            walk_skills(&home.join(".claude").join("skills"), 0, &mut out);
            walk_commands_dir(&home.join(".claude").join("commands"), &mut out);
            out.extend(builtin_claude_commands());
        }
        "codex" => {
            walk_commands_dir(&home.join(".codex").join("prompts"), &mut out);
            out.extend(builtin_codex_commands());
        }
        _ => return Err(format!("알 수 없는 source: {}", source)),
    }
    // 중복 제거 (name 기준 우선; 첫 등장 우선)
    let mut seen = std::collections::HashSet::new();
    out.retain(|s| seen.insert(s.name.clone()));
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(SkillList { skills: out })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(claude_cli::ClaudeSessions::default())
        .manage(claude_cli::RateLimitCache::default())
        .manage(codex_cli::CodexSessions::default())
        .manage(sessions::SessionIndex::default())
        .manage(usage::UsageCache::default())
        .manage(browser::BrowserRegistry::default())
        .manage(accounts::AccountState::default())
        .setup(|app| {
            // 세션 인덱스 백그라운드 워밍업 — Everything 식 캐시
            sessions::start_indexer(app.handle().clone());
            // 계정 자동 로테이션 백그라운드 루프 (90초 주기)
            accounts::start_rotation_task(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_list,
            fs_read,
            fs_write,
            fs_copy,
            fs_move,
            fs_rename,
            fs_delete,
            fs_mkdir,
            fs_new_file,
            fs_skills,
            provider_skills,
            fs_walk::fs_walk,
            sessions::sessions_list,
            sessions::sessions_refresh,
            sessions::session_load,
            search::search_in_dir,
            claude_cli::claude_start,
            claude_cli::claude_send,
            claude_cli::claude_stop,
            claude_cli::claude_stop_all,
            claude_cli::claude_check,
            claude_cli::claude_rate_limit,
            codex_cli::codex_send,
            codex_cli::codex_clear_session,
            codex_cli::codex_check,
            codex_cli::codex_login_status,
            usage::claude_usage,
            usage::codex_usage,
            browser::browser_create,
            browser::browser_navigate,
            browser::browser_set_bounds,
            browser::browser_set_visible,
            browser::browser_close,
            browser::browser_eval,
            accounts::accounts_list,
            accounts::account_add_current,
            accounts::account_remove,
            accounts::account_set_active,
            accounts::account_get_active,
            accounts::account_rename,
            accounts::account_auto_rotate_get,
            accounts::account_auto_rotate_set,
        ])
        .on_window_event(|window, event| {
            // 창 닫히면 모든 Claude PTY 세션 일괄 정리 — 좀비 프로세스 방지
            use tauri::Manager;
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(sessions) =
                    window.try_state::<claude_cli::ClaudeSessions>()
                {
                    claude_cli::kill_all(&sessions);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
