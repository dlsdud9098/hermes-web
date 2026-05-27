// 프로젝트 루트 재귀 fs watcher — 외부 파일 변경(터미널/OS 파일 관리자 등)을
// 실시간 감지해 프론트에 'fs:changed' 이벤트로 영향받은 경로 알림.
//
// notify-debouncer-mini 로 burst 묶음 (e.g. git checkout, npm install) — 200ms 윈도우.
// 노이즈 디렉토리 무시: node_modules / .git / target / dist / .venv / __pycache__ / .next.

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, Debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct FsWatchRegistry {
    /// project_id → debouncer
    pub watchers: Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>,
}

#[derive(Serialize, Clone)]
pub struct FsChangedEvent {
    pub project_id: String,
    /// 변경된 경로들의 부모 디렉토리 (중복 제거됨)
    pub dirs: Vec<String>,
}

const SKIP: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build",
    ".venv", "__pycache__", ".next", ".cache", ".idea", ".vscode-test",
];

fn is_ignored(path: &Path) -> bool {
    for comp in path.components() {
        let s = comp.as_os_str().to_string_lossy();
        if SKIP.iter().any(|skip| *skip == s) { return true; }
    }
    false
}

fn parent_of(path: &Path) -> Option<String> {
    path.parent().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn fs_watch_start(
    app: AppHandle,
    state: tauri::State<'_, FsWatchRegistry>,
    project_id: String,
    root: String,
) -> Result<(), String> {
    // 기존 watcher 있으면 교체 (root 가 바뀌었을 수 있음)
    {
        let mut map = state.watchers.lock().unwrap();
        map.remove(&project_id);
    }
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(format!("경로 없음: {}", root));
    }

    let app_h = app.clone();
    let pid = project_id.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        move |res: Result<Vec<DebouncedEvent>, notify::Error>| {
            let Ok(events) = res else { return; };
            // 영향받은 부모 디렉토리만 모으기 — 중복 제거
            let mut dirs: Vec<String> = events
                .iter()
                .filter(|ev| !is_ignored(&ev.path))
                .filter_map(|ev| parent_of(&ev.path))
                .collect();
            dirs.sort();
            dirs.dedup();
            if dirs.is_empty() { return; }
            let _ = app_h.emit("fs:changed", FsChangedEvent {
                project_id: pid.clone(),
                dirs,
            });
        },
    ).map_err(|e| format!("debouncer 생성: {}", e))?;

    debouncer
        .watcher()
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("watch 시작: {}", e))?;

    state.watchers.lock().unwrap().insert(project_id, debouncer);
    Ok(())
}

#[tauri::command]
pub fn fs_watch_stop(
    state: tauri::State<'_, FsWatchRegistry>,
    project_id: String,
) -> Result<(), String> {
    state.watchers.lock().unwrap().remove(&project_id);
    Ok(())
}
