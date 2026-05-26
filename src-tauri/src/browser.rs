// 인앱 브라우저 — Tauri 2 자식 webview 를 메인 윈도우 안에 임베드.
// MCP 없음 — 직접 Tauri 커맨드로 제어. 같은 커맨드를 에이전트도 호출 가능.
//
// 모델:
//   panel_id ↔ webview label "browser-<panel_id>" 1:1 매핑
//   프론트엔드 BrowserPanel 이 div bbox 를 ResizeObserver 로 측정 →
//     browser_set_bounds 로 webview 위치/크기 동기화
//   탭 전환/패널 숨김 시 set_visible(false)

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};
use url::Url;

#[derive(Default)]
pub struct BrowserRegistry {
    /// 살아있는 webview label 추적 — 중복 create 방지용
    pub labels: Mutex<Vec<String>>,
}

#[derive(Serialize)]
pub struct EvalResult {
    pub value: serde_json::Value,
}

fn label_for(panel_id: &str) -> String {
    format!("browser-{}", panel_id)
}

fn parse_url(s: &str) -> Result<Url, String> {
    let t = s.trim();
    let candidate = if t.is_empty() {
        "about:blank".to_string()
    } else if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("about:") {
        t.to_string()
    } else if t.starts_with("localhost") || t.starts_with("127.0.0.1") || t.starts_with("192.168.") {
        format!("http://{}", t)
    } else if t.contains('.') && !t.contains(' ') {
        format!("https://{}", t)
    } else {
        format!("https://duckduckgo.com/?q={}", urlencoding::encode(t))
    };
    Url::parse(&candidate).map_err(|e| format!("URL 파싱: {}", e))
}

#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    state: tauri::State<'_, BrowserRegistry>,
    panel_id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    {
        let labels = state.labels.lock().unwrap();
        if labels.contains(&label) {
            return Ok(()); // 이미 존재
        }
    }
    // Window 가 add_child 를 갖고 있음. WebviewWindow 는 그 위 합성.
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window 없음".to_string())?;

    let parsed = parse_url(&url)?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed));

    let pos = LogicalPosition::new(x, y);
    let size = LogicalSize::new(w.max(1.0), h.max(1.0));
    window
        .add_child(builder, pos, size)
        .map_err(|e| format!("webview 생성 실패: {}", e))?;

    state.labels.lock().unwrap().push(label);
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    panel_id: String,
    url: String,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    let wv = app
        .webviews()
        .into_iter()
        .find(|(l, _)| l == &label)
        .map(|(_, v)| v)
        .ok_or_else(|| "webview 없음 — browser_create 먼저".to_string())?;
    let parsed = parse_url(&url)?;
    // Tauri 2 webview 는 직접 navigate 가 없음 → JS 로 location 설정
    let js = format!("window.location.href = {}", serde_json::to_string(parsed.as_str()).unwrap());
    wv.eval(&js).map_err(|e| format!("navigate: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    panel_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    let wv = app
        .webviews()
        .into_iter()
        .find(|(l, _)| l == &label)
        .map(|(_, v)| v);
    let Some(wv) = wv else { return Ok(()); };
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position: {}", e))?;
    wv.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)))
        .map_err(|e| format!("set_size: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn browser_set_visible(
    app: AppHandle,
    panel_id: String,
    visible: bool,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    let wv = app
        .webviews()
        .into_iter()
        .find(|(l, _)| l == &label)
        .map(|(_, v)| v);
    let Some(wv) = wv else { return Ok(()); };
    // 숨김은 화면 밖으로 이동 (set_visible API 가 안정 미보장)
    if visible {
        // 위치는 set_bounds 가 다시 잡음. 노-op
    } else {
        let _ = wv.set_position(LogicalPosition::new(-10000.0, -10000.0));
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close(
    app: AppHandle,
    state: tauri::State<'_, BrowserRegistry>,
    panel_id: String,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    if let Some((_, wv)) = app.webviews().into_iter().find(|(l, _)| l == &label) {
        let _ = wv.close();
    }
    state.labels.lock().unwrap().retain(|l| l != &label);
    Ok(())
}

/// 에이전트/UI 가 임베드 브라우저 안에서 JS 실행 — click/fill/scroll 등.
/// JS 의 마지막 식 값이 result 로 반환되지 않으므로 코드 안에서 `__ret = ...` 패턴 권장.
#[tauri::command]
pub async fn browser_eval(
    app: AppHandle,
    panel_id: String,
    code: String,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    let wv = app
        .webviews()
        .into_iter()
        .find(|(l, _)| l == &label)
        .map(|(_, v)| v)
        .ok_or_else(|| "webview 없음".to_string())?;
    wv.eval(&code).map_err(|e| format!("eval: {}", e))?;
    Ok(())
}
