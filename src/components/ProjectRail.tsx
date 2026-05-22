// 세로 프로젝트 탭 레일 (cmux / 디스코드 카테고리 느낌).
// 프로젝트 = 폴더. + 버튼은 폴더 피커를 연다.

import { useProjects } from '../store/projects';

interface ProjectRailProps {
  onOpenFolder: () => void;
  onOpenSettings: () => void;
}

export function ProjectRail({ onOpenFolder, onOpenSettings }: ProjectRailProps) {
  const { projects, activeId, setActive, removeProject } = useProjects();

  return (
    <nav className="rail">
      {projects.map((p) => (
        <button
          key={p.id}
          className={`rail-tab${p.id === activeId ? ' rail-tab-active' : ''}`}
          style={{ borderLeftColor: p.id === activeId ? p.color : 'transparent' }}
          onClick={() => setActive(p.id)}
          onAuxClick={(e) => { if (e.button === 1) removeProject(p.id); }}
          title={`${p.name}\n${p.path}\n(가운데 클릭: 닫기)`}
        >
          <span className="rail-dot" style={{ background: p.color }} />
          <span className="rail-name">{p.name}</span>
        </button>
      ))}
      <button className="rail-add" onClick={onOpenFolder} title="폴더 열기">
        +
      </button>
      <button className="rail-settings" onClick={onOpenSettings} title="설정">
        ⚙
      </button>
    </nav>
  );
}
