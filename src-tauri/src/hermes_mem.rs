// Hermes 메모리 설정 — 내장 파일(MEMORY.md/USER.md) + 외부 provider 전환.
//
// 내장: ~/.hermes/memories/{MEMORY.md,USER.md} (항상 활성). char limit 은 config.memory.*.
// 외부: config.memory.provider 에 plugin 이름 (mem0/honcho/...) 설정 + <provider>.json 으로
//       api_key 등 제공. 한 번에 1개. ''(빈값) = 내장만.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

fn hermes_home() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 디렉토리 미확인".to_string())?;
    Ok(home.join(".hermes"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(hermes_home()?.join("config.yaml"))
}

fn load_config() -> Result<serde_yaml::Value, String> {
    let p = config_path()?;
    let text = fs::read_to_string(&p).map_err(|e| format!("config.yaml 읽기: {}", e))?;
    serde_yaml::from_str(&text).map_err(|e| format!("config.yaml 파싱: {}", e))
}

fn save_config(v: &serde_yaml::Value) -> Result<(), String> {
    let p = config_path()?;
    let text = serde_yaml::to_string(v).map_err(|e| format!("config 직렬화: {}", e))?;
    fs::write(&p, text).map_err(|e| format!("config.yaml 쓰기: {}", e))
}

fn mem_cfg_int(cfg: &serde_yaml::Value, key: &str, default: i64) -> i64 {
    cfg.get("memory")
        .and_then(|m| m.get(key))
        .and_then(|v| v.as_i64())
        .unwrap_or(default)
}

fn mem_cfg_bool(cfg: &serde_yaml::Value, key: &str, default: bool) -> bool {
    cfg.get("memory")
        .and_then(|m| m.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

// ─────────── 내장 파일 ───────────

#[derive(Serialize)]
pub struct MemoryFile {
    pub target: String,   // "memory" | "user"
    pub path: String,
    pub content: String,
    pub exists: bool,
    pub char_limit: i64,
}

#[derive(Serialize)]
pub struct MemoryFiles {
    pub memory: MemoryFile,
    pub user: MemoryFile,
    pub memory_enabled: bool,
    pub user_profile_enabled: bool,
}

fn read_one(dir: &std::path::Path, file: &str, target: &str, limit: i64) -> MemoryFile {
    let p = dir.join(file);
    let exists = p.exists();
    let content = if exists { fs::read_to_string(&p).unwrap_or_default() } else { String::new() };
    MemoryFile {
        target: target.into(),
        path: p.to_string_lossy().to_string(),
        content,
        exists,
        char_limit: limit,
    }
}

#[tauri::command]
pub fn hermes_memory_files() -> Result<MemoryFiles, String> {
    let dir = hermes_home()?.join("memories");
    let cfg = load_config().unwrap_or(serde_yaml::Value::Null);
    Ok(MemoryFiles {
        memory: read_one(&dir, "MEMORY.md", "memory", mem_cfg_int(&cfg, "memory_char_limit", 2200)),
        user: read_one(&dir, "USER.md", "user", mem_cfg_int(&cfg, "user_char_limit", 1375)),
        memory_enabled: mem_cfg_bool(&cfg, "memory_enabled", true),
        user_profile_enabled: mem_cfg_bool(&cfg, "user_profile_enabled", true),
    })
}

#[tauri::command]
pub fn hermes_memory_write_file(target: String, content: String) -> Result<(), String> {
    let file = match target.as_str() {
        "memory" => "MEMORY.md",
        "user" => "USER.md",
        _ => return Err(format!("알 수 없는 target: {}", target)),
    };
    let dir = hermes_home()?.join("memories");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(file), content).map_err(|e| e.to_string())
}

// ─────────── 외부 provider ───────────

#[derive(Serialize)]
pub struct ProviderInfo {
    /// 현재 활성 외부 provider ('' = 내장만)
    pub active: String,
    /// 설치된 plugin 목록 (plugins/memory 하위 디렉토리)
    pub available: Vec<String>,
    /// 각 provider 의 config 파일(<provider>.json) 존재 여부
    pub configured: BTreeMap<String, bool>,
}

fn list_providers() -> Vec<String> {
    let dir = hermes_home()
        .map(|h| h.join("hermes-agent").join("plugins").join("memory"))
        .ok();
    let Some(dir) = dir else { return vec![]; };
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("__") { continue; }
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                out.push(name);
            }
        }
    }
    out.sort();
    out
}

/// plugin 을 python 으로 import 해 get_config_schema() 를 JSON 으로 받아온다.
/// (정적 파싱은 trailing comma / 중복 키 등으로 깨져서 실제 런타임 호출이 정확.)
#[tauri::command]
pub fn hermes_memory_provider_schema(provider: String) -> Result<serde_json::Value, String> {
    // provider 이름 검증 — path/코드 주입 방지 (영숫자/언더스코어/하이픈만)
    if provider.is_empty() || !provider.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(format!("잘못된 provider 이름: {}", provider));
    }
    let agent_dir = hermes_home()?.join("hermes-agent");
    if !agent_dir.exists() {
        return Ok(serde_json::json!([]));
    }
    let script = format!(
        r#"
import sys, json, importlib
sys.path.insert(0, {dir:?})
try:
    m = importlib.import_module("plugins.memory." + {prov:?})
    cls = None
    for n in dir(m):
        o = getattr(m, n)
        if isinstance(o, type) and hasattr(o, "get_config_schema"):
            cls = o; break
    sch = []
    if cls is not None:
        try:
            sch = cls().get_config_schema()
        except Exception:
            try:
                sch = cls.get_config_schema(cls)
            except Exception:
                sch = []
    # 중복 키 제거 (hindsight 등) — 첫 등장 우선
    seen = set(); out = []
    for d in (sch or []):
        k = d.get("key")
        if k and k not in seen:
            seen.add(k); out.append(d)
    print(json.dumps(out))
except Exception as e:
    print(json.dumps({{"__error__": str(e)}}))
"#,
        dir = agent_dir.to_string_lossy(),
        prov = provider,
    );
    let out = std::process::Command::new("python3")
        .arg("-c").arg(&script)
        .current_dir(&agent_dir)
        .output()
        .map_err(|e| format!("python3 실행 불가: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout.trim().lines().last().unwrap_or("");
    if line.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("스키마 가져오기 실패: {}", err.trim()));
    }
    let val: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| format!("스키마 JSON 파싱: {}", e))?;
    if let Some(obj) = val.as_object() {
        if let Some(e) = obj.get("__error__") {
            return Err(format!("plugin 로드 오류: {}", e));
        }
    }
    Ok(val)
}

#[tauri::command]
pub fn hermes_memory_provider_get() -> Result<ProviderInfo, String> {
    let cfg = load_config().unwrap_or(serde_yaml::Value::Null);
    let active = cfg.get("memory")
        .and_then(|m| m.get("provider"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let available = list_providers();
    let home = hermes_home()?;
    let mut configured = BTreeMap::new();
    for p in &available {
        let cfg_file = home.join(format!("{}.json", p));
        configured.insert(p.clone(), cfg_file.exists());
    }
    Ok(ProviderInfo { active, available, configured })
}

#[tauri::command]
pub fn hermes_memory_provider_set(provider: String) -> Result<(), String> {
    let mut cfg = load_config()?;
    // memory 맵이 없으면 생성
    if cfg.get("memory").is_none() {
        if let serde_yaml::Value::Mapping(ref mut map) = cfg {
            map.insert(
                serde_yaml::Value::String("memory".into()),
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
            );
        }
    }
    if let Some(serde_yaml::Value::Mapping(mem)) = cfg.get_mut("memory") {
        mem.insert(
            serde_yaml::Value::String("provider".into()),
            serde_yaml::Value::String(provider),
        );
    } else {
        return Err("config.memory 가 맵이 아님".into());
    }
    save_config(&cfg)
}

/// 외부 provider config 파일 (<provider>.json) 읽기 — 없으면 빈 객체
#[tauri::command]
pub fn hermes_memory_provider_config_get(provider: String) -> Result<String, String> {
    let p = hermes_home()?.join(format!("{}.json", provider));
    if !p.exists() {
        return Ok("{}".into());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// 외부 provider config 파일 쓰기 — JSON 그대로 저장 (검증만)
#[tauri::command]
pub fn hermes_memory_provider_config_set(provider: String, json: String) -> Result<(), String> {
    // JSON 유효성 검증
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("JSON 형식 오류: {}", e))?;
    let p = hermes_home()?.join(format!("{}.json", provider));
    fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hermes_memory_set_enabled(memory_enabled: Option<bool>, user_profile_enabled: Option<bool>) -> Result<(), String> {
    let mut cfg = load_config()?;
    if cfg.get("memory").is_none() {
        if let serde_yaml::Value::Mapping(ref mut map) = cfg {
            map.insert(
                serde_yaml::Value::String("memory".into()),
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
            );
        }
    }
    if let Some(serde_yaml::Value::Mapping(mem)) = cfg.get_mut("memory") {
        if let Some(v) = memory_enabled {
            mem.insert(serde_yaml::Value::String("memory_enabled".into()), serde_yaml::Value::Bool(v));
        }
        if let Some(v) = user_profile_enabled {
            mem.insert(serde_yaml::Value::String("user_profile_enabled".into()), serde_yaml::Value::Bool(v));
        }
    }
    save_config(&cfg)
}
