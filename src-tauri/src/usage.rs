// 구독 사용량 조회 — Claude OAuth API + ChatGPT Codex 비공개 엔드포인트.
//
// Claude: GET https://api.anthropic.com/api/oauth/usage
//   - Bearer = ~/.claude/.credentials.json 의 claudeAiOauth.accessToken
//   - 헤더 anthropic-beta: oauth-2025-04-20 (필수)
//   - 응답: five_hour / seven_day / seven_day_sonnet / seven_day_opus / extra_usage
//     각 Window 는 { utilization (0~1 또는 0~100), resets_at (ISO8601) }
//
// Codex: GET https://chatgpt.com/backend-api/wham/usage
//   - Bearer = ~/.codex/auth.json 의 tokens.access_token
//   - 옵션 헤더 ChatGPT-Account-Id (tokens.account_id)
//   - 응답: rate_limit.{primary,secondary}_window
//     { used_percent (0~100), reset_at (unix sec), limit_window_seconds }
//     + credits, plan_type
//
// 두 엔드포인트 모두 비공개이지만 ccusage / codex-limit / pi-codex-status 등
// 다수 도구가 의존하는 사실상 표준. 60초 메모리 캐시.

use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Default)]
pub struct ClaudeWindow {
    /// 0~100 (서버 응답이 0~1 이면 *100 으로 정규화)
    pub utilization_pct: f64,
    /// ISO8601 또는 빈 문자열
    pub resets_at: String,
    /// 남은 초 (resets_at 기반). 0 이면 미정/리셋됨.
    pub seconds_until_reset: i64,
}

#[derive(Serialize, Clone, Default)]
pub struct ClaudeUsage {
    pub five_hour: Option<ClaudeWindow>,
    pub seven_day: Option<ClaudeWindow>,
    pub seven_day_sonnet: Option<ClaudeWindow>,
    pub seven_day_opus: Option<ClaudeWindow>,
    /// extra_usage 활성 여부 + balance %
    pub extra_usage_pct: Option<f64>,
    pub fetched_at_ms: u64,
}

#[derive(Serialize, Clone, Default)]
pub struct CodexWindow {
    /// 0~100
    pub used_pct: f64,
    /// 윈도우 길이 (초)
    pub window_seconds: i64,
    /// 리셋까지 남은 초
    pub seconds_until_reset: i64,
}

#[derive(Serialize, Clone, Default)]
pub struct CodexUsage {
    pub plan_type: String,
    pub primary: Option<CodexWindow>,   // 5h
    pub secondary: Option<CodexWindow>, // 7d
    pub has_credits: bool,
    pub credits_balance: f64,
    pub fetched_at_ms: u64,
}

#[derive(Default)]
pub struct UsageCache {
    pub claude: Mutex<Option<(Instant, ClaudeUsage)>>,
    pub codex: Mutex<Option<(Instant, CodexUsage)>>,
}

const CACHE_TTL: Duration = Duration::from_secs(60);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn home() -> Result<std::path::PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".into())
}

// ─────────── Claude ───────────

#[derive(Deserialize)]
struct ClaudeCredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<ClaudeAiOauth>,
}
#[derive(Deserialize)]
struct ClaudeAiOauth {
    #[serde(rename = "accessToken")]
    access_token: String,
}

fn read_claude_token() -> Result<String, String> {
    let path = home()?.join(".claude").join(".credentials.json");
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("credentials 읽기 실패: {}", e))?;
    let parsed: ClaudeCredentialsFile = serde_json::from_str(&text)
        .map_err(|e| format!("credentials JSON 파싱 실패: {}", e))?;
    parsed
        .claude_ai_oauth
        .map(|o| o.access_token)
        .ok_or_else(|| "claudeAiOauth.accessToken 없음".into())
}

/// 서버 utilization 값을 0~100 으로 정규화 (0~1 또는 0~100 둘 다 처리)
fn norm_pct(v: &serde_json::Value) -> f64 {
    let n = v.as_f64().unwrap_or(0.0);
    if n <= 1.0 { n * 100.0 } else { n }
}

fn parse_iso_to_remaining_secs(iso: &str) -> i64 {
    // ISO8601 → unix 초 차이. 간단 파서 (chrono 없이 — 의존 추가 회피).
    // 형식: 2026-02-23T22:00:00.177194+00:00 또는 ...Z
    // chrono 없이 직접 파싱.
    fn parse(iso: &str) -> Option<i64> {
        let s = iso.trim();
        // 시간 분리
        let (date_part, time_zone_part) = s.split_once('T')?;
        let mut tz_off_secs: i64 = 0;
        let time_part_owned;
        if let Some(z_idx) = time_zone_part.find('Z') {
            time_part_owned = time_zone_part[..z_idx].to_string();
        } else if let Some(plus) = time_zone_part.rfind('+') {
            time_part_owned = time_zone_part[..plus].to_string();
            let off = &time_zone_part[plus+1..];
            let (oh, om) = off.split_once(':').unwrap_or((off, "0"));
            tz_off_secs = oh.parse::<i64>().ok()? * 3600 + om.parse::<i64>().ok()? * 60;
        } else if let Some(minus) = time_zone_part.rfind('-') {
            // T 뒤에서 마지막 '-' (날짜 '-' 와 구분)
            time_part_owned = time_zone_part[..minus].to_string();
            let off = &time_zone_part[minus+1..];
            let (oh, om) = off.split_once(':').unwrap_or((off, "0"));
            tz_off_secs = -(oh.parse::<i64>().ok()? * 3600 + om.parse::<i64>().ok()? * 60);
        } else {
            time_part_owned = time_zone_part.to_string();
        }
        let mut d = date_part.split('-');
        let y: i64 = d.next()?.parse().ok()?;
        let mo: i64 = d.next()?.parse().ok()?;
        let da: i64 = d.next()?.parse().ok()?;
        let mut t = time_part_owned.split(':');
        let h: i64 = t.next()?.parse().ok()?;
        let mi: i64 = t.next()?.parse().ok()?;
        let sec_part = t.next()?;
        let sec: i64 = sec_part.split('.').next()?.parse().ok()?;
        // 그레고리안 → unix epoch (간이) — Howard Hinnant 알고리즘
        let yr = if mo <= 2 { y - 1 } else { y };
        let era = if yr >= 0 { yr } else { yr - 399 } / 400;
        let yoe = yr - era * 400; // [0, 399]
        let m_adj = if mo > 2 { mo - 3 } else { mo + 9 };
        let doy = (153 * m_adj + 2) / 5 + da - 1; // [0, 365]
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days_since_epoch = era * 146097 + doe - 719468;
        let total_secs = days_since_epoch * 86400 + h * 3600 + mi * 60 + sec - tz_off_secs;
        Some(total_secs)
    }
    let resets_unix = parse(iso).unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    (resets_unix - now).max(0)
}

fn parse_claude_window(v: &serde_json::Value) -> Option<ClaudeWindow> {
    if v.is_null() { return None; }
    let util = v.get("utilization")?;
    let resets_at = v.get("resets_at").and_then(|x| x.as_str()).unwrap_or("").to_string();
    Some(ClaudeWindow {
        utilization_pct: norm_pct(util),
        seconds_until_reset: parse_iso_to_remaining_secs(&resets_at),
        resets_at,
    })
}

async fn fetch_claude() -> Result<ClaudeUsage, String> {
    let token = read_claude_token()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build().map_err(|e| e.to_string())?;
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send().await
        .map_err(|e| format!("HTTP 실패: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let extra = json.get("extra_usage").and_then(|e| {
        let util = e.get("utilization")?;
        if util.is_null() { None } else { Some(norm_pct(util)) }
    });

    Ok(ClaudeUsage {
        five_hour: json.get("five_hour").and_then(parse_claude_window),
        seven_day: json.get("seven_day").and_then(parse_claude_window),
        seven_day_sonnet: json.get("seven_day_sonnet").and_then(parse_claude_window),
        seven_day_opus: json.get("seven_day_opus").and_then(parse_claude_window),
        extra_usage_pct: extra,
        fetched_at_ms: now_ms(),
    })
}

#[tauri::command]
pub async fn claude_usage(
    state: tauri::State<'_, UsageCache>,
    force: bool,
) -> Result<Option<ClaudeUsage>, String> {
    if !force {
        if let Some((t, u)) = state.claude.lock().unwrap().as_ref() {
            if t.elapsed() < CACHE_TTL {
                return Ok(Some(u.clone()));
            }
        }
    }
    match fetch_claude().await {
        Ok(u) => {
            *state.claude.lock().unwrap() = Some((Instant::now(), u.clone()));
            Ok(Some(u))
        }
        Err(_) => Ok(None),
    }
}

// ─────────── Codex ───────────

#[derive(Deserialize)]
struct CodexAuthFile {
    tokens: Option<CodexTokens>,
}
#[derive(Deserialize)]
struct CodexTokens {
    access_token: Option<String>,
    account_id: Option<String>,
}

fn read_codex_token() -> Result<(String, Option<String>), String> {
    let path = home()?.join(".codex").join("auth.json");
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("codex auth 읽기 실패: {}", e))?;
    let parsed: CodexAuthFile = serde_json::from_str(&text)
        .map_err(|e| format!("codex auth JSON 파싱 실패: {}", e))?;
    let toks = parsed.tokens.ok_or("codex auth.tokens 없음")?;
    let tok = toks.access_token.ok_or("codex access_token 없음")?;
    Ok((tok, toks.account_id))
}

fn parse_codex_window(v: &serde_json::Value) -> Option<CodexWindow> {
    if v.is_null() { return None; }
    let used = v.get("used_percent").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let window_seconds = v.get("limit_window_seconds")
        .and_then(|x| x.as_i64()).unwrap_or(0);
    let reset_at = v.get("reset_at").and_then(|x| x.as_i64()).unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    Some(CodexWindow {
        used_pct: used,
        window_seconds,
        seconds_until_reset: (reset_at - now).max(0),
    })
}

async fn fetch_codex() -> Result<CodexUsage, String> {
    let (token, account_id) = read_codex_token()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build().map_err(|e| e.to_string())?;
    let mut req = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json");
    if let Some(aid) = account_id {
        req = req.header("ChatGPT-Account-Id", aid);
    }
    let resp = req.send().await.map_err(|e| format!("HTTP 실패: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let plan_type = json.get("plan_type").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let rate_limit = json.get("rate_limit");
    let primary = rate_limit
        .and_then(|r| r.get("primary_window"))
        .and_then(parse_codex_window);
    let secondary = rate_limit
        .and_then(|r| r.get("secondary_window"))
        .and_then(parse_codex_window);
    let credits = json.get("credits");
    let has_credits = credits.and_then(|c| c.get("has_credits"))
        .and_then(|x| x.as_bool()).unwrap_or(false);
    let credits_balance = credits.and_then(|c| c.get("balance"))
        .and_then(|x| {
            x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))
        }).unwrap_or(0.0);

    Ok(CodexUsage {
        plan_type, primary, secondary,
        has_credits, credits_balance,
        fetched_at_ms: now_ms(),
    })
}

#[tauri::command]
pub async fn codex_usage(
    state: tauri::State<'_, UsageCache>,
    force: bool,
) -> Result<Option<CodexUsage>, String> {
    if !force {
        if let Some((t, u)) = state.codex.lock().unwrap().as_ref() {
            if t.elapsed() < CACHE_TTL {
                return Ok(Some(u.clone()));
            }
        }
    }
    match fetch_codex().await {
        Ok(u) => {
            *state.codex.lock().unwrap() = Some((Instant::now(), u.clone()));
            Ok(Some(u))
        }
        Err(_) => Ok(None),
    }
}
