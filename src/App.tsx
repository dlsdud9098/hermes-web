import { useState } from 'react';
import { ProjectsProvider, useProjects } from './store/projects';
import { ProjectRail } from './components/ProjectRail';
import { Workspace } from './components/Workspace';
import { FolderPicker } from './components/FolderPicker';
import './App.css';

function Shell() {
  const { projects, activeId, openProject } = useProjects();
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="app">
      <ProjectRail onOpenFolder={() => setPickerOpen(true)} />
      {active ? (
        // key={active.id} → 프로젝트 전환 시 Workspace remount, 레이아웃 복원
        <Workspace key={active.id} project={active} />
      ) : (
        <div className="empty">
          <p className="empty-title">열린 프로젝트 없음</p>
          <p className="empty-sub">폴더를 열면 그 폴더가 하나의 프로젝트가 됩니다.</p>
          <button className="btn" onClick={() => setPickerOpen(true)}>폴더 열기</button>
        </div>
      )}
      {pickerOpen && (
        <FolderPicker
          onClose={() => setPickerOpen(false)}
          onPick={(path) => { openProject(path); setPickerOpen(false); }}
        />
      )}
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
