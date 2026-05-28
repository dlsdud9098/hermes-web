// Hermes gateway 자동 launch — 앱 시작 시 :8642 응답 없으면 `hermes gateway run` spawn.
// 앱 종료 시 자식 프로세스 kill (같이 죽음).

use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const PORT: u16 = 8642;

#[derive(Default)]
pub struct HermesProcess(pub Mutex<Option<Child>>);

#[derive(Serialize, Clone)]
pub struct HermesStatus {
    pub port: u16,
    pub running: bool,
    pub managed_by_app: bool,
}

fn probe() -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{}", PORT).parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// 앱 시작 시 호출 — 이미 떠있으면 no-op, 없으면 spawn.
pub fn ensure_started(state: &HermesProcess) {
    if probe() {
        return;
    }
    let res = Command::new("hermes")
        .arg("gateway")
        .arg("run")
        .arg("--replace")        // 좀비 인스턴스 있으면 교체
        .arg("--accept-hooks")    // TTY 없으므로 훅 자동 승인
        // 데스크톱 앱은 webview Origin 을 붙여 보냄 → 게이트웨이 CORS allowlist 가 막음.
        // 로컬 단독 사용이므로 모든 Origin 허용 (key 인증은 그대로 유지됨).
        .env("API_SERVER_CORS_ORIGINS", "*")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match res {
        Ok(child) => {
            *state.0.lock().unwrap() = Some(child);
        }
        Err(e) => {
            eprintln!("[hermes_launch] spawn 실패: {} — `hermes` PATH 확인", e);
        }
    }
}

pub fn kill_managed(state: &HermesProcess) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        #[cfg(unix)]
        {
            // 프로세스 그룹 정리 — hermes 가 띄운 손자까지
            let pid = child.id() as i32;
            unsafe {
                libc::kill(-pid, libc::SIGTERM);
                std::thread::sleep(Duration::from_millis(80));
                libc::kill(-pid, libc::SIGKILL);
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
pub fn hermes_status(state: tauri::State<'_, HermesProcess>) -> HermesStatus {
    let running = probe();
    let managed_by_app = state.0.lock().unwrap().is_some();
    HermesStatus { port: PORT, running, managed_by_app }
}

/// UI 에서 명시적 재시작
#[tauri::command]
pub fn hermes_restart(state: tauri::State<'_, HermesProcess>) -> Result<(), String> {
    kill_managed(&state);
    ensure_started(&state);
    Ok(())
}
