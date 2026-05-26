// 프로젝트 루트 재귀 워크 — Quick Open 용 파일 인덱스 구축.
// node_modules / .git / target 류는 스킵. 결과 개수는 limit(기본 5000) 으로 제한.

use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct WalkEntry {
    pub path: String,
    pub name: String,
    pub rel: String,
}

const SKIP: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".venv",
    "__pycache__",
    ".next",
    ".cache",
];

const DEFAULT_LIMIT: usize = 5000;

#[tauri::command]
pub fn fs_walk(root: String, limit: Option<usize>) -> Result<Vec<WalkEntry>, String> {
    let cap = limit.unwrap_or(DEFAULT_LIMIT);
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("루트가 디렉토리가 아님".to_string());
    }
    let root_canon = fs::canonicalize(&root_path).unwrap_or(root_path.clone());
    let root_str = root_canon.to_string_lossy().to_string();

    let mut out: Vec<WalkEntry> = Vec::new();
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(root_canon.clone());

    while let Some(dir) = queue.pop_front() {
        if out.len() >= cap {
            break;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if SKIP.iter().any(|s| *s == name) {
                continue;
            }
            let ft = match e.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let p = e.path();
            if ft.is_dir() {
                queue.push_back(p);
            } else if ft.is_file() {
                if out.len() >= cap {
                    break;
                }
                let abs = p.to_string_lossy().to_string();
                let rel = abs
                    .strip_prefix(&root_str)
                    .map(|s| s.trim_start_matches(['/', '\\']).to_string())
                    .unwrap_or_else(|| abs.clone());
                out.push(WalkEntry { path: abs, name, rel });
            }
        }
    }

    Ok(out)
}
