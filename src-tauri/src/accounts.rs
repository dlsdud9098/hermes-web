// 계정 풀 + 자동 로테이션.
//
// 여러 Claude/Codex 계정의 credential 스냅샷을 관리하고,
// 활성 계정의 라이브 credential 파일을 스와핑한다.
//
// - Pool: <config>/hermes-web/accounts.json
// - Snapshots: <config>/hermes-web/account-snapshots/<provider>/<id>.json (0600)
// - Live:
//     claude → ~/.claude/.credentials.json
//     codex  → ~/.codex/auth.json
//
// 백그라운드 로테이션: 90초마다 활성 계정의 남은 쿼터를 조회해서
// threshold 미만이면 풀의 다음 계정으로 라운드로빈 스위칭 (anti-oscillation 30초).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

// ─────────── 데이터 모델 ───────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub added_at_ms: u64,
    pub last_used_at_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AutoRotateConfig {
    pub enabled: bool,
    pub threshold_pct: f64,
}

impl Default for AutoRotateConfig {
    fn default() -> Self {
        Self { enabled: false, threshold_pct: 10.0 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AccountPoolFile {
    pub accounts: Vec<Account>,
    pub active: HashMap<String, String>,
    pub auto_rotate: AutoRotateConfig,
}

#[derive(Serialize, Clone, Debug)]
pub struct AccountWithStatus {
    #[serde(flatten)]
    pub account: Account,
    pub is_active: bool,
}

// ─────────── 상태 ───────────

#[derive(Default)]
pub struct AccountState {
    pub pool: Mutex<Option<AccountPoolFile>>,
    pub last_rotation: Mutex<Option<Instant>>,
}

// ─────────── 유틸 ───────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn config_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "config 디렉토리 미확인".to_string())?;
    let p = base.join("hermes-web");
    if !p.exists() {
        fs::create_dir_all(&p).map_err(|e| format!("config dir 생성 실패: {}", e))?;
    }
    Ok(p)
}

fn pool_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("accounts.json"))
}

fn snapshot_dir(provider: &str) -> Result<PathBuf, String> {
    let p = config_dir()?.join("account-snapshots").join(provider);
    if !p.exists() {
        fs::create_dir_all(&p).map_err(|e| format!("snapshot dir 생성 실패: {}", e))?;
    }
    Ok(p)
}

fn snapshot_path(provider: &str, id: &str) -> Result<PathBuf, String> {
    Ok(snapshot_dir(provider)?.join(format!("{}.json", id)))
}

fn live_path(provider: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())?;
    match provider {
        "claude" => Ok(home.join(".claude").join(".credentials.json")),
        "codex" => Ok(home.join(".codex").join("auth.json")),
        _ => Err(format!("알 수 없는 provider: {}", provider)),
    }
}

#[cfg(unix)]
fn chmod_0600(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    perm.set_mode(0o600);
    fs::set_permissions(path, perm).map_err(|e| format!("chmod 실패: {}", e))
}

#[cfg(not(unix))]
fn chmod_0600(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// .tmp 에 쓰고 rename — 원자적 쓰기 + 0600.
fn atomic_write_0600(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("부모 디렉토리 생성: {}", e))?;
        }
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| format!("tmp 쓰기 실패: {}", e))?;
    let _ = chmod_0600(&tmp);
    fs::rename(&tmp, path).map_err(|e| format!("rename 실패: {}", e))?;
    let _ = chmod_0600(path);
    Ok(())
}

// ─────────── 풀 로드/세이브 ───────────

fn load_pool_from_disk() -> AccountPoolFile {
    let path = match pool_path() {
        Ok(p) => p,
        Err(_) => return AccountPoolFile::default(),
    };
    if !path.exists() {
        return AccountPoolFile::default();
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return AccountPoolFile::default(),
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_pool(pool: &AccountPoolFile) -> Result<(), String> {
    let path = pool_path()?;
    let data = serde_json::to_vec_pretty(pool).map_err(|e| e.to_string())?;
    atomic_write_0600(&path, &data)
}

/// State 의 pool 을 lazy 로드해서 클로저에 넘긴다.
fn with_pool<F, R>(state: &AccountState, f: F) -> Result<R, String>
where
    F: FnOnce(&mut AccountPoolFile) -> Result<R, String>,
{
    let mut guard = state.pool.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(load_pool_from_disk());
    }
    let pool = guard.as_mut().unwrap();
    let result = f(pool)?;
    save_pool(pool)?;
    Ok(result)
}

fn read_pool(state: &AccountState) -> Result<AccountPoolFile, String> {
    let mut guard = state.pool.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(load_pool_from_disk());
    }
    Ok(guard.as_ref().unwrap().clone())
}

// ─────────── Tauri 커맨드 ───────────

/// 특정 provider 의 계정 목록 + 활성 여부 표시.
#[tauri::command]
pub async fn accounts_list(
    state: tauri::State<'_, AccountState>,
    provider: String,
) -> Result<Vec<AccountWithStatus>, String> {
    let pool = read_pool(&state)?;
    let active = pool.active.get(&provider).cloned();
    let out = pool
        .accounts
        .into_iter()
        .filter(|a| a.provider == provider)
        .map(|a| {
            let is_active = active.as_ref().map(|id| id == &a.id).unwrap_or(false);
            AccountWithStatus { account: a, is_active }
        })
        .collect();
    Ok(out)
}

/// 현재 라이브 credential 파일을 스냅샷으로 저장 + 풀에 추가.
/// 해당 provider 의 첫 계정이면 자동으로 active 로 지정.
#[tauri::command]
pub async fn account_add_current(
    state: tauri::State<'_, AccountState>,
    provider: String,
    label: String,
) -> Result<Account, String> {
    let live = live_path(&provider)?;
    if !live.exists() {
        return Err(format!(
            "라이브 credential 없음: {}. 먼저 로그인하세요.",
            live.display()
        ));
    }
    let data = fs::read(&live).map_err(|e| format!("credential 읽기 실패: {}", e))?;

    let id = uuid::Uuid::new_v4().to_string();
    let snap = snapshot_path(&provider, &id)?;
    atomic_write_0600(&snap, &data)?;

    let acc = Account {
        id: id.clone(),
        label,
        provider: provider.clone(),
        added_at_ms: now_ms(),
        last_used_at_ms: now_ms(),
    };

    with_pool(&state, |pool| {
        pool.accounts.push(acc.clone());
        let has_active_for_provider = pool
            .accounts
            .iter()
            .any(|a| a.provider == provider && Some(&a.id) == pool.active.get(&provider));
        if !has_active_for_provider {
            pool.active.insert(provider.clone(), id.clone());
        }
        Ok(())
    })?;

    Ok(acc)
}

/// 스냅샷 파일 + 풀 엔트리 제거. 활성 계정이었으면 active 해제 (라이브는 건드리지 않음).
#[tauri::command]
pub async fn account_remove(
    state: tauri::State<'_, AccountState>,
    provider: String,
    id: String,
) -> Result<(), String> {
    let snap = snapshot_path(&provider, &id)?;
    if snap.exists() {
        let _ = fs::remove_file(&snap);
    }
    with_pool(&state, |pool| {
        pool.accounts.retain(|a| !(a.provider == provider && a.id == id));
        if pool.active.get(&provider) == Some(&id) {
            pool.active.remove(&provider);
        }
        Ok(())
    })
}

/// 스냅샷을 라이브 경로에 원자적 복사. active 맵 갱신 + last_used 갱신.
#[tauri::command]
pub async fn account_set_active(
    state: tauri::State<'_, AccountState>,
    provider: String,
    id: String,
) -> Result<(), String> {
    let snap = snapshot_path(&provider, &id)?;
    if !snap.exists() {
        return Err(format!("스냅샷 없음: {}", snap.display()));
    }
    let data = fs::read(&snap).map_err(|e| format!("스냅샷 읽기 실패: {}", e))?;
    let live = live_path(&provider)?;
    atomic_write_0600(&live, &data)?;

    with_pool(&state, |pool| {
        if !pool.accounts.iter().any(|a| a.provider == provider && a.id == id) {
            return Err(format!("풀에 계정 없음: {}", id));
        }
        pool.active.insert(provider.clone(), id.clone());
        for a in pool.accounts.iter_mut() {
            if a.provider == provider && a.id == id {
                a.last_used_at_ms = now_ms();
            }
        }
        Ok(())
    })
}

/// 활성 계정 id (없으면 None).
#[tauri::command]
pub async fn account_get_active(
    state: tauri::State<'_, AccountState>,
    provider: String,
) -> Result<Option<String>, String> {
    let pool = read_pool(&state)?;
    Ok(pool.active.get(&provider).cloned())
}

/// 라벨 변경.
#[tauri::command]
pub async fn account_rename(
    state: tauri::State<'_, AccountState>,
    provider: String,
    id: String,
    label: String,
) -> Result<(), String> {
    with_pool(&state, |pool| {
        let found = pool
            .accounts
            .iter_mut()
            .find(|a| a.provider == provider && a.id == id);
        match found {
            Some(a) => {
                a.label = label;
                Ok(())
            }
            None => Err(format!("계정 없음: {}", id)),
        }
    })
}

/// 자동 로테이션 설정 조회.
#[tauri::command]
pub async fn account_auto_rotate_get(
    state: tauri::State<'_, AccountState>,
) -> Result<AutoRotateConfig, String> {
    let pool = read_pool(&state)?;
    Ok(pool.auto_rotate)
}

/// 자동 로테이션 설정 변경.
#[tauri::command]
pub async fn account_auto_rotate_set(
    state: tauri::State<'_, AccountState>,
    config: AutoRotateConfig,
) -> Result<(), String> {
    with_pool(&state, |pool| {
        pool.auto_rotate = config;
        Ok(())
    })
}

// ─────────── 백그라운드 자동 로테이션 ───────────

/// 라이브 credential 기반으로 활성 계정의 남은 쿼터(%)를 조회.
/// usage.rs 의 fetch_* 가 private 이라 재호출하지 않고, 같은 엔드포인트를 직접 친다.
async fn fetch_claude_remaining_pct() -> Option<f64> {
    #[derive(Deserialize)]
    struct CredFile {
        #[serde(rename = "claudeAiOauth")]
        oauth: Option<Oauth>,
    }
    #[derive(Deserialize)]
    struct Oauth {
        #[serde(rename = "accessToken")]
        access_token: String,
    }
    let path = live_path("claude").ok()?;
    let text = fs::read_to_string(&path).ok()?;
    let cred: CredFile = serde_json::from_str(&text).ok()?;
    let token = cred.oauth?.access_token;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;

    fn norm(v: &serde_json::Value) -> f64 {
        let n = v.get("utilization").and_then(|x| x.as_f64()).unwrap_or(0.0);
        if n <= 1.0 { n * 100.0 } else { n }
    }
    let mut max_util: f64 = 0.0;
    for key in ["five_hour", "seven_day", "seven_day_sonnet", "seven_day_opus"] {
        if let Some(w) = json.get(key) {
            if !w.is_null() {
                let u = norm(w);
                if u > max_util { max_util = u; }
            }
        }
    }
    Some((100.0 - max_util).max(0.0))
}

async fn fetch_codex_remaining_pct() -> Option<f64> {
    #[derive(Deserialize)]
    struct AuthFile {
        tokens: Option<Tokens>,
    }
    #[derive(Deserialize)]
    struct Tokens {
        access_token: Option<String>,
        account_id: Option<String>,
    }
    let path = live_path("codex").ok()?;
    let text = fs::read_to_string(&path).ok()?;
    let auth: AuthFile = serde_json::from_str(&text).ok()?;
    let toks = auth.tokens?;
    let token = toks.access_token?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let mut req = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json");
    if let Some(aid) = toks.account_id {
        req = req.header("ChatGPT-Account-Id", aid);
    }
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;

    let rate = json.get("rate_limit");
    let mut max_used: f64 = 0.0;
    for key in ["primary_window", "secondary_window"] {
        if let Some(w) = rate.and_then(|r| r.get(key)) {
            if !w.is_null() {
                let u = w.get("used_percent").and_then(|x| x.as_f64()).unwrap_or(0.0);
                if u > max_used { max_used = u; }
            }
        }
    }
    Some((100.0 - max_used).max(0.0))
}

/// 다음 계정 (라운드로빈) — 풀에서 provider 매칭 + 현재 활성 아닌 첫 항목 우선.
fn pick_next_account(pool: &AccountPoolFile, provider: &str, current: &str) -> Option<Account> {
    let candidates: Vec<&Account> = pool
        .accounts
        .iter()
        .filter(|a| a.provider == provider)
        .collect();
    if candidates.len() < 2 {
        return None;
    }
    let idx = candidates.iter().position(|a| a.id == current)?;
    let next = candidates[(idx + 1) % candidates.len()];
    if next.id == current { None } else { Some(next.clone()) }
}

/// 단일 provider 의 로테이션 평가 + 실행.
async fn try_rotate(app: &AppHandle, provider: &str) {
    let state = match app.try_state::<AccountState>() {
        Some(s) => s,
        None => return,
    };

    let pool = match read_pool(&state) {
        Ok(p) => p,
        Err(_) => return,
    };
    if !pool.auto_rotate.enabled {
        return;
    }
    let active_id = match pool.active.get(provider) {
        Some(s) => s.clone(),
        None => return,
    };
    let count = pool.accounts.iter().filter(|a| a.provider == provider).count();
    if count < 2 {
        return;
    }

    let remaining = match provider {
        "claude" => fetch_claude_remaining_pct().await,
        "codex" => fetch_codex_remaining_pct().await,
        _ => None,
    };
    let remaining = match remaining {
        Some(r) => r,
        None => return,
    };
    if remaining >= pool.auto_rotate.threshold_pct {
        return;
    }

    // anti-oscillation: 마지막 로테이션 < 30초면 스킵
    {
        let last = state.last_rotation.lock().ok().and_then(|g| *g);
        if let Some(t) = last {
            if t.elapsed() < Duration::from_secs(30) {
                return;
            }
        }
    }

    let next = match pick_next_account(&pool, provider, &active_id) {
        Some(n) => n,
        None => return,
    };
    let from = pool
        .accounts
        .iter()
        .find(|a| a.provider == provider && a.id == active_id)
        .cloned();

    // 스왑 실행 — 직접 동일 로직 인라인.
    let snap = match snapshot_path(provider, &next.id) {
        Ok(p) => p,
        Err(_) => return,
    };
    if !snap.exists() {
        return;
    }
    let data = match fs::read(&snap) {
        Ok(d) => d,
        Err(_) => return,
    };
    let live = match live_path(provider) {
        Ok(p) => p,
        Err(_) => return,
    };
    if atomic_write_0600(&live, &data).is_err() {
        return;
    }

    let _ = with_pool(&state, |pool| {
        pool.active.insert(provider.to_string(), next.id.clone());
        for a in pool.accounts.iter_mut() {
            if a.provider == provider && a.id == next.id {
                a.last_used_at_ms = now_ms();
            }
        }
        Ok(())
    });

    if let Ok(mut g) = state.last_rotation.lock() {
        *g = Some(Instant::now());
    }

    let from_id = from.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    let from_label = from.as_ref().map(|a| a.label.clone()).unwrap_or_default();
    let _ = app.emit(
        "accounts:rotated",
        serde_json::json!({
            "provider": provider,
            "from_id": from_id,
            "from_label": from_label,
            "to_id": next.id,
            "to_label": next.label,
            "reason": format!("remaining {:.1}% < threshold {:.1}%", remaining, pool.auto_rotate.threshold_pct),
        }),
    );
}

/// 백그라운드 로테이션 루프 — 90초 주기. std::thread 위에서 mini tokio runtime 으로 await.
pub fn start_rotation_task(app: AppHandle) {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(_) => return,
        };
        rt.block_on(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(90)).await;
                try_rotate(&app, "claude").await;
                try_rotate(&app, "codex").await;
            }
        });
    });
}
