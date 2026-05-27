// Hermes 전용 설정 — 보유 스킬 리스트 + USER.md 메모리 편집.
// 세션 기록 모달과 형식 통일 (overlay + dialog).

import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '../runtime';

interface Skill { name: string; description: string; }
interface SkillList { skills: Skill[]; }

interface Memory { path: string; content: string; exists: boolean; }

interface Props {
  onClose: () => void;
}

type Tab = 'skills' | 'memory';

export function HermesConfigModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [filter, setFilter] = useState('');
  const [memory, setMemory] = useState<Memory | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadSkills = useCallback(async () => {
    if (!isTauri) return;
    try {
      const r = await invoke<SkillList>('provider_skills', { source: 'hermes' });
      setSkills(r.skills);
    } catch (e) { setErr(String(e)); }
  }, []);

  const loadMemory = useCallback(async () => {
    if (!isTauri) return;
    try {
      const m = await invoke<Memory>('hermes_memory_read');
      setMemory(m);
      setDraft(m.content);
      setDirty(false);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { loadSkills(); loadMemory(); }, [loadSkills, loadMemory]);

  async function saveMemory() {
    if (!isTauri || saving) return;
    setSaving(true);
    try {
      await invoke<void>('hermes_memory_write', { content: draft });
      setDirty(false);
      await loadMemory();
    } catch (e) { setErr(String(e)); }
    setSaving(false);
  }

  const filtered = skills.filter((s) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal hermes-config" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">🜲 Hermes 전용 설정</span>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="hermes-config-tabs">
          <button
            className={`hermes-config-tab${tab === 'skills' ? ' active' : ''}`}
            onClick={() => setTab('skills')}
          >📦 스킬 ({skills.length})</button>
          <button
            className={`hermes-config-tab${tab === 'memory' ? ' active' : ''}`}
            onClick={() => setTab('memory')}
          >🧠 메모리 (USER.md){dirty && ' *'}</button>
        </div>
        {err && <div className="hermes-config-err">⚠ {err}</div>}
        {tab === 'skills' ? (
          <div className="hermes-config-body">
            <input
              className="hermes-skill-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="스킬 이름/설명 검색…"
            />
            <div className="hermes-skill-list">
              {filtered.length === 0 && <div className="hermes-empty">스킬 없음</div>}
              {filtered.map((s) => (
                <div key={s.name} className="hermes-skill-row">
                  <span className="hermes-skill-name">/{s.name}</span>
                  <span className="hermes-skill-desc">{s.description || '(설명 없음)'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="hermes-config-body">
            <div className="hermes-mem-meta">
              {memory?.path}{memory && !memory.exists && ' (아직 없음 — 저장 시 생성)'}
            </div>
            <textarea
              className="hermes-mem-editor"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
              placeholder="Hermes 가 매 대화에 참조할 사용자 메모. 마크다운."
              spellCheck={false}
            />
            <div className="hermes-mem-bar">
              <span className="hermes-mem-count">{draft.length} 자</span>
              <button
                className="btn"
                onClick={saveMemory}
                disabled={!dirty || saving}
              >
                {saving ? '저장 중…' : dirty ? '저장' : '변경 없음'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
