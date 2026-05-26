// 프로젝트 전체 키워드 검색 (VS Code 식 grep). 순수 Rust — 별도 ripgrep 의존성 없음.
//
// 성능 한도:
//  - 파일당 최대 2MB 까지만 읽음 (대형 데이터/덤프 스킵)
//  - 결과 총 max_results 도달 시 조기 중단
//  - 흔한 빌드 산출물 디렉토리(node_modules, .git, target, dist, .venv, __pycache__) 자동 제외
//  - 바이너리 추정 파일(헤드 4KB 안에 NUL 바이트) 스킵

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 500;
const CONTEXT_RADIUS: usize = 40; // 매치 전후 표시 문자 수

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", "out",
    ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache",
    "vendor", ".idea", ".vscode", "coverage", ".tauri",
];

#[derive(Serialize)]
pub struct SearchHit {
    pub file: String,
    pub line: u32,
    /// 매치된 라인 (양옆 컨텍스트 트리밍 적용)
    pub text: String,
    /// `text` 안에서 매치 시작 오프셋 (UTF-8 byte)
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(serde::Deserialize)]
pub struct SearchOpts {
    pub root: String,
    pub query: String,
    /// 대소문자 무시
    #[serde(default)]
    pub case_insensitive: bool,
    /// 숨김 파일/폴더 포함
    #[serde(default)]
    pub include_hidden: bool,
    /// 결과 최대 개수
    pub max_results: Option<usize>,
}

fn is_skipped_dir(name: &str, include_hidden: bool) -> bool {
    if !include_hidden && name.starts_with('.') {
        return true;
    }
    SKIP_DIRS.iter().any(|s| *s == name)
}

/// 헤드 4KB 에 NUL 이 있으면 바이너리로 간주
fn looks_binary(path: &Path) -> bool {
    let mut f = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return true,
    };
    let mut buf = [0u8; 4096];
    let n = match f.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return true,
    };
    buf[..n].contains(&0)
}

fn read_capped(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// `haystack` 안에서 `needle` 의 시작 오프셋들 찾기 (case insensitive 옵션).
/// haystack/needle 가 ascii-only 일 때는 빠른 경로, 아니면 lowercase 비교.
fn find_all(haystack: &str, needle: &str, ci: bool) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = Vec::new();
    if needle.is_empty() {
        return out;
    }
    if !ci {
        let mut start = 0;
        while let Some(i) = haystack[start..].find(needle) {
            let abs = start + i;
            out.push((abs, abs + needle.len()));
            start = abs + needle.len();
        }
    } else {
        // 길이 변환 가능성 때문에 단순화: lowercase 양쪽에서 동일 인덱스 가정 (ASCII 한정).
        // 그 외(한글 등)는 단순 substring 매칭만 — 인덱스는 lowercase 버전 기준.
        let lh = haystack.to_lowercase();
        let ln = needle.to_lowercase();
        let mut start = 0;
        while let Some(i) = lh[start..].find(&ln) {
            let abs = start + i;
            // lowercase 인덱스가 원문 인덱스와 다를 수 있으나 표시용으로는 충분.
            out.push((abs, abs + ln.len()));
            start = abs + ln.len();
        }
    }
    out
}

fn walk(dir: &Path, opts: &SearchOpts, hits: &mut Vec<SearchHit>, limit: usize) {
    if hits.len() >= limit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for e in entries.flatten() {
        if hits.len() >= limit {
            return;
        }
        let name_os = e.file_name();
        let name = name_os.to_string_lossy();
        let ft = match e.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let path = e.path();
        if ft.is_dir() {
            if is_skipped_dir(&name, opts.include_hidden) {
                continue;
            }
            walk(&path, opts, hits, limit);
        } else if ft.is_file() {
            if !opts.include_hidden && name.starts_with('.') {
                continue;
            }
            if looks_binary(&path) {
                continue;
            }
            let content = match read_capped(&path) {
                Some(s) => s,
                None => continue,
            };
            search_in_text(&path, &content, opts, hits, limit);
        }
    }
}

fn search_in_text(
    path: &Path,
    content: &str,
    opts: &SearchOpts,
    hits: &mut Vec<SearchHit>,
    limit: usize,
) {
    for (idx, line) in content.lines().enumerate() {
        if hits.len() >= limit {
            return;
        }
        let matches = find_all(line, &opts.query, opts.case_insensitive);
        for (mstart, mend) in matches {
            if hits.len() >= limit {
                return;
            }
            // 컨텍스트 트리밍 — 매치 주변만
            let line_bytes = line.as_bytes();
            let from = mstart.saturating_sub(CONTEXT_RADIUS);
            let to = std::cmp::min(line_bytes.len(), mend + CONTEXT_RADIUS);
            // UTF-8 경계로 보정
            let from = floor_char_boundary(line, from);
            let to = ceil_char_boundary(line, to);
            let snippet = &line[from..to];
            let prefix = if from > 0 { "…" } else { "" };
            let suffix = if to < line.len() { "…" } else { "" };
            let text = format!("{}{}{}", prefix, snippet, suffix);
            let adj_start = (mstart - from) + prefix.len();
            let adj_end = (mend - from) + prefix.len();
            hits.push(SearchHit {
                file: path.to_string_lossy().to_string(),
                line: (idx + 1) as u32,
                text,
                match_start: adj_start as u32,
                match_end: adj_end as u32,
            });
        }
    }
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() { return s.len(); }
    while !s.is_char_boundary(i) { i -= 1; }
    i
}
fn ceil_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() { return s.len(); }
    while !s.is_char_boundary(i) { i += 1; }
    i
}

#[tauri::command]
pub fn search_in_dir(opts: SearchOpts) -> Result<Vec<SearchHit>, String> {
    if opts.query.is_empty() {
        return Ok(Vec::new());
    }
    let root = PathBuf::from(&opts.root);
    if !root.is_dir() {
        return Err(format!("디렉토리 아님: {}", opts.root));
    }
    let limit = opts.max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let mut hits: Vec<SearchHit> = Vec::new();
    walk(&root, &opts, &mut hits, limit);
    Ok(hits)
}
