// 채팅 컴포저 위에 뜨는 슬래시(/) 스킬 자동완성 드롭다운.
// 표시 전용 — 필터·선택 인덱스는 ChatPanel 이 관리한다.
//
// 성능:
//  - React.memo — 부모 (ChatPanel) 가 채팅 스트리밍으로 자주 리렌더되어도
//    skills / selectedIndex 가 동일하면 메뉴는 리렌더 안 함.
//  - SkillItem 도 memo — 활성 인덱스 1개만 바뀌어도 60개 전체 리렌더 막음.
//  - CSS contain: layout paint style + will-change: scroll-position 으로
//    스크롤 시 레이아웃/페인트 격리.
//  - scrollIntoView 는 selectedIndex 변화 시에만 — 휠 스크롤엔 영향 없음.

import { memo, useEffect, useRef } from 'react';
import type { Skill } from '../api/skills';

interface SkillMenuProps {
  skills: Skill[];
  selectedIndex: number;
  onPick: (skill: Skill) => void;
}

interface SkillItemProps {
  skill: Skill;
  active: boolean;
  onPick: (s: Skill) => void;
  itemRef?: React.Ref<HTMLButtonElement>;
}

const SkillItem = memo(function SkillItem({ skill, active, onPick, itemRef }: SkillItemProps) {
  return (
    <button
      ref={itemRef}
      className={`skill-item${active ? ' skill-item-active' : ''}`}
      // mousedown + preventDefault → textarea 포커스 유지하며 선택
      onMouseDown={(e) => { e.preventDefault(); onPick(skill); }}
    >
      <span className="skill-name">/{skill.name}</span>
      {skill.description && <span className="skill-desc">{skill.description}</span>}
    </button>
  );
});

function SkillMenuInner({ skills, selectedIndex, onPick }: SkillMenuProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // 키보드 이동 시 선택 항목 보이게 스크롤 — 휠 스크롤 중엔 트리거 안 됨
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (skills.length === 0) return null;

  return (
    <div className="skill-menu">
      {skills.map((s, i) => (
        <SkillItem
          key={s.name}
          skill={s}
          active={i === selectedIndex}
          onPick={onPick}
          itemRef={i === selectedIndex ? activeRef : undefined}
        />
      ))}
    </div>
  );
}

export const SkillMenu = memo(SkillMenuInner);
