import { useRef, useState } from 'react';
import type { DockviewApi } from 'dockview';
import { ProjectsProvider, useProjects, uid } from './store/projects';
import { ProjectRail } from './components/ProjectRail';
import { Workspace } from './components/Workspace';
import { FolderPicker } from './components/FolderPicker';
import { SettingsModal } from './components/SettingsModal';
import './App.css';

function Shell() {
  const { projects, activeId, openProject } = useProjects();
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 활성 Workspace 의 dockview api — 레일 파일 트리에서 뷰어 패널을 열 때 쓴다
  const dockApiRef = useRef<DockviewApi | null>(null);

  return (
    <div className="app">
      <ProjectRail
        onOpenFolder={() => setPickerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFile={(file) => {
          dockApiRef.current?.addPanel({
            id: uid('panel'),
            component: 'fileviewer',
            title: file.name,
            params: { filePath: file.path },
          });
        }}
      />
      {active ? (
        // key={active.id} → 프로젝트 전환 시 Workspace remount, 레이아웃 복원
        <Workspace
          key={active.id}
          project={active}
          onApiReady={(api) => { dockApiRef.current = api; }}
        />
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
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
