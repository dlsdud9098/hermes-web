import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockviewApi } from 'dockview';
import { ProjectsProvider, useProjects, uid } from './store/projects';
import { SettingsProvider } from './store/settings';
import { ProjectRail } from './components/ProjectRail';
import { Workspace } from './components/Workspace';
import { FolderPicker } from './components/FolderPicker';
import { SettingsModal } from './components/SettingsModal';
import { SessionBrowser } from './components/SessionBrowser';
import { useGlobalShortcuts } from './keybindings';
import { useSettings } from './store/settings';
import './App.css';

function Shell() {
  const { projects, activeId, openProject, setActive } = useProjects();
  const { settings } = useSettings();
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
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

  // SearchPanel 의 결과 클릭 → FileViewer 패널 열기 (line 은 후속 기능)
  useEffect(() => {
    function onOpenFile(e: Event) {
      const ce = e as CustomEvent<{ filePath: string; line?: number }>;
      const api = dockApiRef.current;
      if (!api) return;
      const filePath = ce.detail.filePath;
      const name = filePath.split(/[/\\]/).pop() ?? 'file';
      api.addPanel({
        id: uid('panel'),
        component: 'fileviewer',
        title: name,
        params: { filePath },
      });
    }
    window.addEventListener('hermes:open-file', onOpenFile);
    return () => window.removeEventListener('hermes:open-file', onOpenFile);
  }, []);

  const openSearchPanel = useCallback(() => {
    const api = dockApiRef.current;
    if (!api || !active) return;
    // 이미 같은 프로젝트 검색 패널이 있으면 활성화만
    const existing = api.panels.find((p) => p.view.contentComponent === 'search');
    if (existing) {
      existing.api.setActive();
      return;
    }
    api.addPanel({
      id: uid('panel'),
      component: 'search',
      title: `🔎 ${active.name} 검색`,
      params: { projectPath: active.path },
    });
  }, [active]);

  const openFolderPicker = useCallback(() => setPickerOpen(true), []);

  const addSession = useCallback((mode: 'tab' | 'right' | 'below') => {
    const api = dockApiRef.current;
    if (!api || !active) return;
    const isClaude = settings.chatProvider === 'claude';
    api.addPanel({
      id: uid('panel'),
      component: isClaude ? 'claudecode' : 'chat',
      title: `${isClaude ? 'Claude' : '세션'} ${api.panels.length + 1}`,
      params: { projectId: active.id },
      ...(mode === 'tab' ? {} : { position: { direction: mode } }),
    });
  }, [active, settings.chatProvider]);

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
    newSessionTab: () => addSession('tab'),
    newSessionSplitH: () => addSession('right'),
    newSessionSplitV: () => addSession('below'),
    closeActivePanel,
    openSettings: () => setSettingsOpen(true),
    openFolder: openFolderPicker,
    toggleFileTree: () => setTreeOpen((o) => !o),
    previewActive,
    openSearch: openSearchPanel,
    openSessions: () => setSessionsOpen(true),
    switchProject: (i: number) => {
      const p = projects[i - 1];
      if (p) setActive(p.id);
    },
  }), [addSession, closeActivePanel, openFolderPicker,
       previewActive, openSearchPanel, projects, setActive]);

  useGlobalShortcuts(shortcuts, settings.keymap);

  return (
    <div className="app">
      <ProjectRail
        treeOpen={treeOpen}
        setTreeOpen={setTreeOpen}
        onOpenFolder={() => setPickerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSessions={() => setSessionsOpen(true)}
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
      {sessionsOpen && (
        <SessionBrowser
          onClose={() => setSessionsOpen(false)}
          onOpen={(s) => {
            const api = dockApiRef.current;
            if (!api) return;
            const name = s.title.length > 32 ? s.title.slice(0, 32) + '…' : s.title;
            api.addPanel({
              id: uid('panel'),
              component: 'sessionviewer',
              title: `📜 ${name}`,
              params: { source: s.source, file: s.file },
            });
          }}
        />
      )}
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
