import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockviewApi } from 'dockview';
import { ProjectsProvider, useProjects, uid } from './store/projects';
import { SettingsProvider } from './store/settings';
import { ProjectRail } from './components/ProjectRail';
import { Workspace } from './components/Workspace';
import { FolderPicker } from './components/FolderPicker';
import { SettingsModal } from './components/SettingsModal';
import { SessionBrowser } from './components/SessionBrowser';
import { HermesConfigModal } from './components/HermesConfigModal';
import { CommandPalette, type Command } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { StatusBar } from './components/StatusBar';
import { useGlobalShortcuts, ACTIONS } from './keybindings';
import { useSettings } from './store/settings';
import { invoke as invokeRuntime, isTauri as isTauriEnv } from './runtime';
import './App.css';

function Shell() {
  const { projects, activeId, openProject, setActive,
          addTab, closeTab, setActiveTab, cycleRecentTab } = useProjects();
  const { settings } = useSettings();
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'appearance' | 'chat' | 'editor' | 'files' | 'keys' | 'accounts'
  >('appearance');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [hermesConfigOpen, setHermesConfigOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  // StatusBar 의 패널 수 표시용 — dockview 패널 변동 시 갱신
  const [panelCount, setPanelCount] = useState(0);
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
    function onOpenSettings(e: Event) {
      const ce = e as CustomEvent<{ tab?: typeof settingsInitialTab }>;
      if (ce.detail?.tab) setSettingsInitialTab(ce.detail.tab);
      setSettingsOpen(true);
    }
    window.addEventListener('hermes:open-settings', onOpenSettings);
    return () => {
      window.removeEventListener('hermes:open-preview', onOpenPreview);
      window.removeEventListener('hermes:open-settings', onOpenSettings);
    };
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

  // 인앱 브라우저 패널 열기
  const openBrowser = useCallback((url?: string) => {
    const api = dockApiRef.current;
    if (!api) return;
    api.addPanel({
      id: uid('panel'),
      component: 'browser',
      title: url ? `🌐 ${new URL(url.startsWith('http') ? url : `http://${url}`).hostname}` : '🌐 브라우저',
      params: { url: url ?? '' },
    });
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

  // Kanban 토글 — 활성 dockview 에 'kanban' 패널 있으면 close, 없으면 add
  const toggleKanban = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.view.contentComponent === 'kanban');
    if (existing) {
      existing.api.close();
    } else {
      api.addPanel({
        id: uid('panel'),
        component: 'kanban',
        title: '📋 Kanban',
        params: {},
      });
    }
  }, []);

  // 탭 추가는 store 의 addTab — Workspace 가 탭 전환을 감지해 dockview remount
  const newTab = useCallback(() => {
    if (!active) return;
    addTab(active.id);
  }, [active, addTab]);

  // 활성 패널 안에서 분할 (현재 탭의 dockview 에 panel 추가)
  const splitPanel = useCallback((mode: 'right' | 'below') => {
    const api = dockApiRef.current;
    if (!api || !active) return;
    const p = settings.chatProvider;
    const comp = p === 'claude' ? 'claudecode'
      : p === 'codex' ? 'codex'
      : p === 'hermes' ? 'channel' : 'chat';
    // Hermes 채널은 1개만 — 이미 있으면 활성화 (분할로 중복 생성 안 함)
    if (comp === 'channel') {
      const existing = api.panels.find((pn) => pn.view.contentComponent === 'channel');
      if (existing) { existing.api.setActive(); return; }
    }
    const label = p === 'claude' ? 'Claude'
      : p === 'codex' ? 'Codex'
      : p === 'hermes' ? '# 채널' : '세션';
    api.addPanel({
      id: uid('panel'),
      component: comp,
      title: `${label} ${api.panels.length + 1}`,
      params: { projectId: active.id },
      position: { direction: mode },
    });
  }, [active, settings.chatProvider]);

  // 활성 탭 통째로 닫기 — store 가 그 탭의 layout + 모든 panel 함께 제거
  const closeActiveTab = useCallback(() => {
    if (!active) return;
    closeTab(active.id, active.activeTabId);
  }, [active, closeTab]);

  // 활성 패널 1개만 close — 같은 탭의 다른 분할은 유지
  const closeActivePanel = useCallback(() => {
    dockApiRef.current?.activePanel?.api.close();
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
    newSessionTab: newTab,
    // 가로 분할 = 가로선 = 위아래 배치
    newSessionSplitH: () => splitPanel('below'),
    // 세로 분할 = 세로선 = 좌우 배치
    newSessionSplitV: () => splitPanel('right'),
    closeActiveTab,
    closeActivePanel,
    openSettings: () => setSettingsOpen(true),
    openFolder: openFolderPicker,
    toggleFileTree: () => setTreeOpen((o) => !o),
    previewActive,
    openSearch: openSearchPanel,
    openSessions: () => setSessionsOpen(true),
    openCommandPalette: () => setPaletteOpen(true),
    quickOpen: () => setQuickOpenOpen(true),
    cycleRecentTab: () => { if (active) cycleRecentTab(active.id); },
    switchProject: (i: number) => {
      const p = projects[i - 1];
      if (p) setActive(p.id);
    },
    switchTab: (i: number) => {
      if (!active) return;
      const t = active.tabs[i - 1];
      if (t) setActiveTab(active.id, t.id);
    },
    switchPanel: (i: number) => {
      const api = dockApiRef.current;
      const p = api?.panels[i - 1];
      if (p) p.api.setActive();
    },
  }), [newTab, splitPanel, closeActiveTab, closeActivePanel, openFolderPicker,
       previewActive, openSearchPanel, projects, setActive,
       active, setActiveTab, cycleRecentTab]);

  useGlobalShortcuts(shortcuts, settings.keymap);

  // 명령 팔레트용 명령 리스트 — ACTIONS + 프로젝트/탭 + 백엔드 상태 확인
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    // 키맵 액션
    for (const a of ACTIONS) {
      cmds.push({
        id: `action:${a.id}`,
        label: a.label,
        group: '액션',
        shortcut: settings.keymap[a.id],
        run: () => {
          // shortcuts 객체 안의 동명 메서드 호출 — type-safe 디스패치
          const fn = (shortcuts as unknown as Record<string, () => void>)[a.id];
          if (fn) fn();
        },
      });
    }
    // 프로젝트 전환
    for (const p of projects) {
      cmds.push({
        id: `proj:${p.id}`,
        label: `프로젝트 전환: ${p.name}`,
        group: '프로젝트',
        run: () => setActive(p.id),
      });
    }
    // 활성 프로젝트의 탭 전환
    if (active) {
      for (const t of active.tabs) {
        cmds.push({
          id: `tab:${t.id}`,
          label: `탭 전환: ${t.name}`,
          group: '탭',
          run: () => setActiveTab(active.id, t.id),
        });
      }
    }
    // 백엔드 점검
    cmds.push({
      id: 'sys:claude_check',
      label: 'Claude CLI 상태 점검',
      group: '시스템',
      run: () => {
        if (!isTauriEnv) return;
        void invokeRuntime<unknown>('claude_check').then((s) => {
          // 콘솔 로그로 대체 — 별도 UI 없이 빠른 점검
          // eslint-disable-next-line no-console
          console.log('[claude_check]', s);
        });
      },
    });
    // 브라우저 패널 열기
    cmds.push({
      id: 'panel:browser',
      label: '🌐 새 브라우저 패널 (인앱 iframe)',
      group: '패널',
      run: () => openBrowser(),
    });
    return cmds;
  }, [shortcuts, projects, active, setActive, setActiveTab, settings.keymap, openBrowser]);

  return (
    <div className="app">
      <div className="app-body">
      <ProjectRail
        treeOpen={treeOpen}
        setTreeOpen={setTreeOpen}
        onOpenFolder={() => setPickerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSessions={() => setSessionsOpen(true)}
        onOpenKanban={toggleKanban}
        onOpenHermesConfig={() => setHermesConfigOpen(true)}
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
          onApiReady={(api) => {
            dockApiRef.current = api;
            setPanelCount(api.panels.length);
            // dockview API: onDidAddPanel / onDidRemovePanel 로 카운트 동기화
            api.onDidAddPanel(() => setPanelCount(api.panels.length));
            api.onDidRemovePanel(() => setPanelCount(api.panels.length));
          }}
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
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          initialTab={settingsInitialTab}
        />
      )}
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
      {hermesConfigOpen && (
        <HermesConfigModal onClose={() => setHermesConfigOpen(false)} />
      )}
      {paletteOpen && (
        <CommandPalette
          commands={commands}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {quickOpenOpen && active && (
        <QuickOpen
          root={active.path}
          onClose={() => setQuickOpenOpen(false)}
        />
      )}
      </div>
      <StatusBar panelCount={panelCount} />
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
