import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockviewApi } from 'dockview';
import { ProjectsProvider, useProjects, uid } from './store/projects';
import { SettingsProvider } from './store/settings';
import { ProjectRail } from './components/ProjectRail';
import { Workspace } from './components/Workspace';
import { FolderPicker } from './components/FolderPicker';
import { SettingsModal } from './components/SettingsModal';
import { useGlobalShortcuts } from './keybindings';
import './App.css';

function Shell() {
  const { projects, activeId, openProject, setActive } = useProjects();
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  // 활성 Workspace 의 dockview api — 레일 파일 트리에서 뷰어 패널을 열 때 + 단축키
  const dockApiRef = useRef<DockviewApi | null>(null);

  // FileViewer 의 '프리뷰' 버튼 → 분할 패널로 HtmlPreview 열기
  useEffect(() => {
    function onOpenPreview(e: Event) {
      const ce = e as CustomEvent<{ filePath: string }>;
      const api = dockApiRef.current;
      if (!api) return;
      const filePath = ce.detail.filePath;
      const name = filePath.split(/[/\\]/).pop() ?? 'preview';
      api.addPanel({
        id: uid('panel'),
        component: 'htmlpreview',
        title: `▶ ${name}`,
        params: { filePath },
        position: { direction: 'right' as const },
      });
    }
    window.addEventListener('hermes:open-preview', onOpenPreview);
    return () => window.removeEventListener('hermes:open-preview', onOpenPreview);
  }, []);

  const openFolderPicker = useCallback(() => setPickerOpen(true), []);

  const newSessionTab = useCallback(() => {
    const api = dockApiRef.current;
    if (!api || !active) return;
    api.addPanel({
      id: uid('panel'),
      component: 'chat',
      title: `세션 ${api.panels.length + 1}`,
      params: { projectId: active.id },
    });
  }, [active]);

  const newSessionSplit = useCallback(() => {
    const api = dockApiRef.current;
    if (!api || !active) return;
    api.addPanel({
      id: uid('panel'),
      component: 'chat',
      title: `세션 ${api.panels.length + 1}`,
      params: { projectId: active.id },
      position: { direction: 'right' as const },
    });
  }, [active]);

  const closeActivePanel = useCallback(() => {
    const api = dockApiRef.current;
    const panel = api?.activePanel;
    if (panel) panel.api.close();
  }, []);

  const previewActive = useCallback(() => {
    const api = dockApiRef.current;
    const panel = api?.activePanel;
    if (!panel) return;
    // 현재 활성 패널이 파일 뷰어면 그 파일을 프리뷰
    const params = panel.params as { filePath?: string } | undefined;
    if (!params?.filePath) return;
    window.dispatchEvent(new CustomEvent('hermes:open-preview', {
      detail: { filePath: params.filePath },
    }));
  }, []);

  const shortcuts = useMemo(() => ({
    newSessionTab,
    newSessionSplit,
    closeActivePanel,
    openSettings: () => setSettingsOpen(true),
    openFolder: openFolderPicker,
    toggleFileTree: () => setTreeOpen((o) => !o),
    previewActive,
    switchProject: (i: number) => {
      const p = projects[i - 1];
      if (p) setActive(p.id);
    },
  }), [newSessionTab, newSessionSplit, closeActivePanel, openFolderPicker,
       previewActive, projects, setActive]);

  useGlobalShortcuts(shortcuts);

  return (
    <div className="app">
      <ProjectRail
        treeOpen={treeOpen}
        setTreeOpen={setTreeOpen}
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
    <SettingsProvider>
      <ProjectsProvider>
        <Shell />
      </ProjectsProvider>
    </SettingsProvider>
  );
}
