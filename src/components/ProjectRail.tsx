// 세로 프로젝트 탭 레일 (cmux / 디스코드 카테고리 느낌).

import { useProjects } from '../store/projects';

export function ProjectRail() {
  const { projects, activeId, setActive, addProject, removeProject } = useProjects();

  return (
    <nav className="rail">
      {projects.map((p) => (
        <button
          key={p.id}
          className={`rail-tab${p.id === activeId ? ' rail-tab-active' : ''}`}
          style={{ borderLeftColor: p.id === activeId ? p.color : 'transparent' }}
          onClick={() => setActive(p.id)}
          onAuxClick={(e) => { if (e.button === 1) removeProject(p.id); }}
          title={`${p.name} (가운데 클릭: 삭제)`}
        >
          <span className="rail-dot" style={{ background: p.color }} />
          <span className="rail-name">{p.name}</span>
        </button>
      ))}
      <button
        className="rail-add"
        onClick={() => {
          const name = window.prompt('새 프로젝트 이름');
          if (name !== null) addProject(name);
        }}
        title="프로젝트 추가"
      >
        +
      </button>
    </nav>
  );
}
