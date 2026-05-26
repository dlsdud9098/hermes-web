// Windows 릴리스 빌드에서 콘솔 창 숨김
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux Wayland: 멀티-윈도우 절대 위치가 컴포지터에 의해 무시됨.
    // BrowserPanel 의 자식 윈도우 오버레이가 정확히 떠야 하므로 Xwayland 로 폴백.
    // Tauri/wry/GTK 초기화 전에 환경변수 설정.
    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false);
        let already_forced = std::env::var("GDK_BACKEND")
            .map(|v| v == "x11" || v == "wayland")
            .unwrap_or(false);
        if is_wayland && !already_forced {
            unsafe { std::env::set_var("GDK_BACKEND", "x11"); }
        }
    }
    hermes_web_lib::run()
}
