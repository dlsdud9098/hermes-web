// Hermes 전용 설정 — 보유 스킬 리스트 + 메모리(내장 파일 + 외부 provider).

import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '../runtime';
import { HermesMemoryTab } from './HermesMemoryTab';

interface Skill { name: string; description: string; }
interface SkillList { skills: Skill[]; }

interface Props {
  onClose: () => void;
}

type Tab = 'skills' | 'memory';

export function HermesConfigModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [filter, setFilter] = useState('');
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

  useEffect(() => { loadSkills(); }, [loadSkills]);

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
          >🧠 메모리</button>
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
          <HermesMemoryTab setErr={setErr} />
        )}
      </div>
    </div>
  );
}
