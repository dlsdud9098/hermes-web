// Hermes 메모리 설정 탭 — 내장 파일(MEMORY.md/USER.md) 편집 + 외부 provider 전환.

import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '../runtime';

interface MemoryFile {
  target: 'memory' | 'user';
  path: string;
  content: string;
  exists: boolean;
  char_limit: number;
}
interface MemoryFiles {
  memory: MemoryFile;
  user: MemoryFile;
  memory_enabled: boolean;
  user_profile_enabled: boolean;
}
interface ProviderInfo {
  active: string;
  available: string[];
  configured: Record<string, boolean>;
}
interface SchemaField {
  key: string;
  description?: string;
  secret?: boolean;
  required?: boolean;
  default?: string;
  choices?: string[];
  url?: string;
  env_var?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  '': '내장만 (MEMORY.md / USER.md)',
  mem0: 'mem0',
  honcho: 'Honcho',
  byterover: 'Byterover',
  hindsight: 'Hindsight',
  holographic: 'Holographic',
  openviking: 'OpenViking',
  retaindb: 'RetainDB',
  supermemory: 'Supermemory',
};

interface EditorProps {
  file: MemoryFile;
  label: string;
  hint: string;
  onSaved: () => void;
  setErr: (e: string) => void;
}

function FileEditor({ file, label, hint, onSaved, setErr }: EditorProps) {
  const [draft, setDraft] = useState(file.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(file.content); setDirty(false); }, [file.content, file.path]);

  const over = draft.length > file.char_limit;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await invoke<void>('hermes_memory_write_file', { target: file.target, content: draft });
      setDirty(false);
      onSaved();
    } catch (e) { setErr(String(e)); }
    setSaving(false);
  }

  return (
    <div className="mem-editor-block">
      <div className="mem-editor-label">
        <span>{label}</span>
        <span className="mem-editor-hint">{hint}</span>
      </div>
      <textarea
        className="hermes-mem-editor"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        spellCheck={false}
        rows={8}
      />
      <div className="hermes-mem-bar">
        <span className={`hermes-mem-count${over ? ' over' : ''}`}>
          {draft.length} / {file.char_limit} 자{over ? ' — 초과! 에이전트가 잘라 읽음' : ''}
        </span>
        <button className="btn" onClick={save} disabled={!dirty || saving}>
          {saving ? '저장 중…' : dirty ? '저장' : '변경 없음'}
        </button>
      </div>
    </div>
  );
}

interface Props { setErr: (e: string) => void; }

export function HermesMemoryTab({ setErr }: Props) {
  const [files, setFiles] = useState<MemoryFiles | null>(null);
  const [prov, setProv] = useState<ProviderInfo | null>(null);
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingProv, setSavingProv] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!isTauri) return;
    try { setFiles(await invoke<MemoryFiles>('hermes_memory_files')); }
    catch (e) { setErr(String(e)); }
  }, [setErr]);

  // 활성 provider 의 스키마 + 저장된 값 로드
  const loadProviderForm = useCallback(async (name: string) => {
    if (!name) { setSchema([]); setValues({}); return; }
    try {
      const [sch, raw] = await Promise.all([
        invoke<SchemaField[]>('hermes_memory_provider_schema', { provider: name }),
        invoke<string>('hermes_memory_provider_config_get', { provider: name }),
      ]);
      setSchema(sch);
      let saved: Record<string, string> = {};
      try { saved = JSON.parse(raw); } catch { saved = {}; }
      // 기본값 + 저장값 병합 (문자열화)
      const merged: Record<string, string> = {};
      for (const f of sch) {
        const v = saved[f.key] ?? f.default ?? '';
        merged[f.key] = typeof v === 'string' ? v : String(v);
      }
      setValues(merged);
    } catch (e) { setErr(String(e)); setSchema([]); setValues({}); }
  }, [setErr]);

  const loadProv = useCallback(async () => {
    if (!isTauri) return;
    try {
      const p = await invoke<ProviderInfo>('hermes_memory_provider_get');
      setProv(p);
      await loadProviderForm(p.active);
    } catch (e) { setErr(String(e)); }
  }, [setErr, loadProviderForm]);

  useEffect(() => { loadFiles(); loadProv(); }, [loadFiles, loadProv]);

  async function selectProvider(name: string) {
    setSavingProv(true);
    try {
      await invoke<void>('hermes_memory_provider_set', { provider: name });
      await loadProv();
    } catch (e) { setErr(String(e)); }
    setSavingProv(false);
  }

  async function saveProvConfig() {
    if (!prov?.active) return;
    // 빈 값은 제외하고 저장 (default 가 알아서 채움)
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== '') out[k] = v;
    }
    setSavingProv(true);
    try {
      await invoke<void>('hermes_memory_provider_config_set', {
        provider: prov.active, json: JSON.stringify(out, null, 2),
      });
      await loadProv();
    } catch (e) { setErr(String(e)); }
    setSavingProv(false);
  }

  if (!isTauri) return <div className="hermes-empty">데스크톱 모드 전용</div>;

  const missingRequired = schema.some((f) => f.required && !values[f.key]);

  return (
    <div className="hermes-config-body mem-tab">
      {/* provider 선택 */}
      <div className="mem-provider">
        <div className="mem-provider-head">메모리 백엔드</div>
        <select
          className="mem-provider-select"
          value={prov?.active ?? ''}
          onChange={(e) => selectProvider(e.target.value)}
          disabled={savingProv}
        >
          <option value="">{PROVIDER_LABEL['']}</option>
          {prov?.available.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p] ?? p}{prov.configured[p] ? ' ✓' : ''}
            </option>
          ))}
        </select>
        <div className="mem-provider-note">
          {prov?.active
            ? `외부 provider "${prov.active}" 활성 — 내장 파일도 함께 동작`
            : '내장 파일만 사용 (외부 provider 꺼짐)'}
        </div>
        {prov?.active && (
          <div className="mem-provider-config">
            {schema.length === 0 && (
              <div className="mem-editor-hint">설정 항목 없음 (이 provider 는 환경변수/로컬 모드)</div>
            )}
            {schema.map((f) => (
              <div key={f.key} className="mem-field">
                <label className="mem-field-label">
                  {f.key}
                  {f.required && <span className="mem-field-req"> *</span>}
                  {f.url && (
                    <a className="mem-field-url" href={f.url} target="_blank" rel="noreferrer">↗ 발급</a>
                  )}
                </label>
                {f.choices ? (
                  <select
                    className="mem-field-input"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input
                    className="mem-field-input"
                    type={f.secret ? 'password' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={f.default ? `기본: ${f.default}` : ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
                {f.description && <div className="mem-field-desc">{f.description}</div>}
              </div>
            ))}
            <div className="hermes-mem-bar">
              <span className="hermes-mem-count">~/.hermes/{prov.active}.json</span>
              <button
                className="btn"
                onClick={saveProvConfig}
                disabled={savingProv || missingRequired}
                title={missingRequired ? '필수 항목(*) 입력 필요' : ''}
              >
                {prov.active} 설정 저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 내장 파일 편집 */}
      {files && (
        <>
          <FileEditor
            file={files.memory}
            label="🧠 MEMORY.md"
            hint="에이전트 노트 — 환경/프로젝트 사실"
            onSaved={loadFiles}
            setErr={setErr}
          />
          <FileEditor
            file={files.user}
            label="👤 USER.md"
            hint="사용자 프로필 — 선호/소통 스타일"
            onSaved={loadFiles}
            setErr={setErr}
          />
        </>
      )}
    </div>
  );
}
