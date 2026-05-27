// 한 프로젝트의 작업 공간 — cmux/tmux 모델.
//   상단: 탭 바 — 각 탭이 독립된 dockview workspace (window).
//   본문: 활성 탭의 dockview — 안에서 panel 들을 자유 분할 (pane).
// 탭 닫기 = 그 탭의 모든 panel 사라짐.

import { useCallback, useEffect, useRef } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { ChatPanel } from './ChatPanel';
import { PanelTab } from './PanelTab';
import { FileViewerPanel } from './FileViewer';
import { HtmlPreviewPanel } from './HtmlPreview';
import { SessionViewerPanel } from './SessionViewer';
import { SearchPanel } from './SearchPanel';
import { ClaudeCodePanel } from './ClaudeCodePanel';
import { CodexPanel } from './CodexPanel';
import { BrowserPanel } from './BrowserPanel';
import { TabBar } from './TabBar';
import { useProjects, uid } from '../store/projects';
import { useSettings } from '../store/settings';
import type { Project } from '../types';

interface ChatParams { projectId: string }
interface ViewerParams { filePath: string }
interface SessionViewerParams { source: 'claude' | 'codex'; file: string }
interface SearchParams { projectPath: string }

/** 탭 이동 대기열 — 탭 전환 후 새 dockview onReady 가 적용 */
interface PendingPanel {
  panelId: string;
  component: string;
  title: string;
  params: Record<string, unknown>;
}
const pendingMoves = new Map<string, PendingPanel[]>();
function pushPending(tabId: string, p: PendingPanel) {
  const arr = pendingMoves.get(tabId) ?? [];
  arr.push(p);
  pendingMoves.set(tabId, arr);
}
function drainPending(tabId: string): PendingPanel[] {
  const arr = pendingMoves.get(tabId) ?? [];
  pendingMoves.delete(tabId);
  return arr;
}

function emitOpenFile(filePath: string, line: number) {
  window.dispatchEvent(new CustomEvent('hermes:open-file', {
    detail: { filePath, line },
  }));
}

const components = {
  chat: (props: IDockviewPanelProps<ChatParams>) => (
    <ChatPanel panelId={props.api.id} projectId={props.params.projectId} />
  ),
  fileviewer: (props: IDockviewPanelProps<ViewerParams>) => (
    <FileViewerPanel filePath={props.params.filePath} />
  ),
  htmlpreview: (props: IDockviewPanelProps<ViewerParams>) => (
    <HtmlPreviewPanel filePath={props.params.filePath} />
  ),
  sessionviewer: (props: IDockviewPanelProps<SessionViewerParams>) => (
    <SessionViewerPanel source={props.params.source} file={props.params.file} />
  ),
  search: (props: IDockviewPanelProps<SearchParams>) => (
    <SearchPanel projectPath={props.params.projectPath} onOpenFile={emitOpenFile} />
  ),
  claudecode: (props: IDockviewPanelProps<ChatParams>) => (
    <ClaudeCodePanel panelId={props.api.id} projectId={props.params.projectId} />
  ),
  codex: (props: IDockviewPanelProps<ChatParams>) => (
    <CodexPanel panelId={props.api.id} projectId={props.params.projectId} />
  ),
  browser: (props: IDockviewPanelProps<{ url?: string }>) => (
    <BrowserPanel panelId={props.api.id} initialUrl={props.params.url ?? ''} />
  ),
};

interface WorkspaceProps {
  project: Project;
  /** dockview api 준비 시 App 에 노출 — 레일·검색·프리뷰가 패널 추가에 사용 */
  onApiReady: (api: DockviewApi) => void;
}

export function Workspace({ project, onApiReady }: WorkspaceProps) {
  const { saveLayout, addTab, closeTab, setActiveTab, renameTab } = useProjects();
  // 'hermes:move-panel-to-tab' 이벤트 처리 — 패널 ↔ 탭 이동
  useEffect(() => {
    function onMove(e: Event) {
      const api = apiRef.current;
      if (!api) return;
      const ce = e as CustomEvent<{
        panelId: string; title: string; params: Record<string, unknown>; targetTabId: string;
      }>;
      const { panelId, title, params, targetTabId } = ce.detail;
      const panel = api.panels.find((p) => p.api.id === panelId);
      if (!panel) return;
      const component = panel.view.contentComponent;
      pushPending(targetTabId, { panelId, component, title, params });
      panel.api.close();
      // 약간 지연 후 탭 전환 — close 가 layout 갱신을 트리거하므로
      setTimeout(() => setActiveTab(project.id, targetTabId), 0);
    }
    window.addEventListener('hermes:move-panel-to-tab', onMove);
    return () => window.removeEventListener('hermes:move-panel-to-tab', onMove);
  }, [project.id, setActiveTab]);
  const { settings } = useSettings();
  const apiRef = useRef<DockviewApi | null>(null);
  const counterRef = useRef(1);

  const activeTab = project.tabs.find((t) => t.id === project.activeTabId) ?? project.tabs[0];

  const seed = useCallback((api: DockviewApi) => {
    const provider = settings.chatProvider;
    const comp = provider === 'claude' ? 'claudecode'
      : provider === 'codex' ? 'codex' : 'chat';
    const label = provider === 'claude' ? 'Claude'
      : provider === 'codex' ? 'Codex' : '세션';
    api.addPanel({
      id: uid('panel'),
      component: comp,
      title: `${label} 1`,
      params: { projectId: project.id },
    });
  }, [project.id, settings.chatProvider]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    onApiReady(event.api);

    if (activeTab.layout) {
      try {
        event.api.fromJSON(activeTab.layout as Parameters<DockviewApi['fromJSON']>[0]);
      } catch {
        seed(event.api);
      }
    } else {
      seed(event.api);
    }

    // 다른 탭에서 이동해온 대기 패널 추가
    const pending = drainPending(activeTab.id);
    for (const p of pending) {
      try {
        event.api.addPanel({
          id: p.panelId,
          component: p.component,
          title: p.title,
          params: p.params,
        });
      } catch {
        // 중복 id 등 — skip
      }
    }

    counterRef.current = event.api.panels.length + 1;

    // 활성 탭 레이아웃 영속화
    const persist = () => saveLayout(project.id, activeTab.id, event.api.toJSON());
    event.api.onDidLayoutChange(persist);
    for (const panel of event.api.panels) panel.api.onDidTitleChange(persist);
    event.api.onDidAddPanel((panel) => panel.api.onDidTitleChange(persist));
  }, [project.id, activeTab.id, activeTab.layout, saveLayout, seed, onApiReady]);

  // 파일 트리에서 드래그&드롭 → 파일 뷰어 패널 열기 (VSCode 식)
  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-hermes-file')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData('application/x-hermes-file');
    if (!raw) return;
    e.preventDefault();
    try {
      const { path, name } = JSON.parse(raw) as { path: string; name: string };
      const api = apiRef.current;
      if (!api) return;
      // 같은 파일이 이미 열려있으면 활성화만
      const existing = api.panels.find((p) => {
        const params = p.params as { filePath?: string } | undefined;
        return params?.filePath === path;
      });
      if (existing) { existing.api.setActive(); return; }
      api.addPanel({
        id: uid('panel'),
        component: 'fileviewer',
        title: name,
        params: { filePath: path },
      });
    } catch {
      // JSON 파싱 실패 — 무시
    }
  }

  return (
    <div className="workspace" onDragOver={onDragOver} onDrop={onDrop}>
      <TabBar
        tabs={project.tabs}
        activeId={project.activeTabId}
        onSwitch={(id) => setActiveTab(project.id, id)}
        onAdd={() => addTab(project.id)}
        onClose={(id) => closeTab(project.id, id)}
        onRename={(id, name) => renameTab(project.id, id, name)}
      />
      {/* key={activeTab.id} → 탭 전환 시 DockviewReact 완전 remount, 각 탭의 layout 복원 */}
      <DockviewReact
        key={activeTab.id}
        className={`workspace-dock dockview-theme-${
          settings.theme === 'dark' ? 'abyss' : 'light'
        }`}
        components={components}
        defaultTabComponent={PanelTab}
        onReady={onReady}
      />
    </div>
  );
}
