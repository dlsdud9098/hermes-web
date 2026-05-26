// Hermes Web — Tauri 백엔드.
// fs_* 커맨드는 기존 vite dev 미들웨어(/fs/list, /fs/read, /fs/write, /fs/skills)와
// 같은 시맨틱. 프론트엔드는 Tauri 환경에서만 invoke 로 호출.
// Hermes 게이트웨이(HTTP/SSE) 는 별도 tauri-plugin-http 로 직접 호출 (CORS 우회).

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
    const MAX: u64 = 256 * 1024;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            fs_list,
            fs_read,
            fs_write,
            fs_skills,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
