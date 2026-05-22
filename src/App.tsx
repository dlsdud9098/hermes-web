import { ProjectsProvider, useProjects } from './store/projects';
import { ProjectRail } from './components/ProjectRail';
import { Workspace } from './components/Workspace';
import './App.css';

function Shell() {
  const { projects, activeId } = useProjects();
  const active = projects.find((p) => p.id === activeId) ?? projects[0];

  return (
    <div className="app">
      <ProjectRail />
      {/* key={active.id} → 프로젝트 전환 시 Workspace remount, 레이아웃 복원 */}
      <Workspace key={active.id} project={active} />
    </div>
  );
}

export default function App() {
  return (
    <ProjectsProvider>
      <Shell />
    </ProjectsProvider>
  );
}
