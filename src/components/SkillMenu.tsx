// 채팅 컴포저 위에 뜨는 슬래시(/) 스킬 자동완성 드롭다운.
// 표시 전용 — 필터·선택 인덱스는 ChatPanel 이 관리한다.

import { useEffect, useRef } from 'react';
import type { Skill } from '../api/skills';

interface SkillMenuProps {
  skills: Skill[];
  selectedIndex: number;
  onPick: (skill: Skill) => void;
}

export function SkillMenu({ skills, selectedIndex, onPick }: SkillMenuProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // 키보드로 이동 시 선택 항목이 보이도록 스크롤
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (skills.length === 0) return null;

  return (
    <div className="skill-menu">
      {skills.map((s, i) => (
        <button
          key={s.name}
          ref={i === selectedIndex ? activeRef : undefined}
          className={`skill-item${i === selectedIndex ? ' skill-item-active' : ''}`}
          // mousedown + preventDefault → textarea 포커스 유지하며 선택
          onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
        >
          <span className="skill-name">/{s.name}</span>
          {s.description && <span className="skill-desc">{s.description}</span>}
        </button>
      ))}
    </div>
  );
}
