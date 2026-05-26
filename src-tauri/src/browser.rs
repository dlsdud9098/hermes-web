// 인앱 브라우저 (실용판) — 별도 borderless WebviewWindow 를 메인 위에 겹쳐 띄움.
//
// 멀티 webview (`add_child`) 가 Linux 에서 깨져 있어 회피 (tauri#10420/11376/10011).
// WebviewWindow 는 Win/Mac/Linux 모두 안정.
//
// 흐름:
//   1) 프론트가 패널 slot 의 절대 화면 좌표(메인 윈도우 inner pos + bbox) 계산
//   2) browser_create 가 그 좌표/크기로 decorations=false, skip_taskbar, parent(main) 윈도우 spawn
//   3) ResizeObserver/Interval/메인 이동 등으로 좌표 변화 → browser_set_bounds
//   4) 패널이 화면 밖으로 가거나 탭이 비활성 → browser_hide
//   5) 패널 unmount → browser_close

use std::sync::Mutex;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager,
    WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

#[derive(Default)]
pub struct BrowserRegistry {
    pub labels: Mutex<Vec<String>>,
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
    x: f64, y: f64, w: f64, h: f64,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    {
        let labels = state.labels.lock().unwrap();
        if labels.contains(&label) { return Ok(()); }
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window 없음".to_string())?;
    let parsed = parse_url(&url)?;

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("hermes-web browser")
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .inner_size(w.max(50.0), h.max(50.0))
        .position(x, y);
    // 부모 = 메인 — 메인 닫히면 같이 닫힘, 포커스 동반.
    // parent() 가 Result 또는 self 를 반환하는 버전 차이 → 두 경우 모두 처리.
    let builder = match builder.parent(&main) {
        Ok(b) => b,
        Err(_) => return Err("parent 설정 실패".into()),
    };
    let _wv = builder
        .build()
        .map_err(|e| format!("browser window 생성: {}", e))?;

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
        .get_webview_window(&label)
        .ok_or_else(|| "browser window 없음 — browser_create 먼저".to_string())?;
    let parsed = parse_url(&url)?;
    let js = format!(
        "window.location.href = {}",
        serde_json::to_string(parsed.as_str()).unwrap()
    );
    wv.eval(&js).map_err(|e| format!("navigate: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    panel_id: String,
    x: f64, y: f64, w: f64, h: f64,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    let Some(wv) = app.get_webview_window(&label) else { return Ok(()); };
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position: {}", e))?;
    wv.set_size(LogicalSize::new(w.max(50.0), h.max(50.0)))
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
    let Some(wv) = app.get_webview_window(&label) else { return Ok(()); };
    if visible { wv.show().map_err(|e| e.to_string())?; }
    else       { wv.hide().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub async fn browser_close(
    app: AppHandle,
    state: tauri::State<'_, BrowserRegistry>,
    panel_id: String,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    if let Some(wv) = app.get_webview_window(&label) {
        let _ = wv.close();
    }
    state.labels.lock().unwrap().retain(|l| l != &label);
    Ok(())
}

#[tauri::command]
pub async fn browser_eval(
    app: AppHandle,
    panel_id: String,
    code: String,
) -> Result<(), String> {
    let label = label_for(&panel_id);
    let wv = app
        .get_webview_window(&label)
        .ok_or_else(|| "browser window 없음".to_string())?;
    wv.eval(&code).map_err(|e| format!("eval: {}", e))?;
    Ok(())
}
