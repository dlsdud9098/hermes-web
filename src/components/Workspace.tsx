// 한 프로젝트의 작업 공간 — cmux/tmux 모델.
//   상단: 탭 바 — 각 탭이 독립된 dockview workspace (window).
//   본문: 활성 탭의 dockview — 안에서 panel 들을 자유 분할 (pane).
// 탭 닫기 = 그 탭의 모든 panel 사라짐.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { ChatPanel } from './ChatPanel';
import { ChannelPanel } from './ChannelPanel';
import { PanelTab } from './PanelTab';
import { FileViewerPanel } from './FileViewer';
import { HtmlPreviewPanel } from './HtmlPreview';
import { SessionViewerPanel } from './SessionViewer';
import { SearchPanel } from './SearchPanel';
import { ClaudeCodePanel } from './ClaudeCodePanel';
import { CodexPanel } from './CodexPanel';
import { BrowserPanel } from './BrowserPanel';
import { KanbanPanel } from './KanbanPanel';
import { TabBar } from './TabBar';
import { useProjects, uid } from '../store/projects';
import { useSettings } from '../store/settings';
import type { Project } from '../types';

interface ChatParams { projectId: string; initialMessage?: string }
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
    <ChatPanel
      panelId={props.api.id}
      projectId={props.params.projectId}
      initialMessage={props.params.initialMessage}
    />
  ),
  channel: (props: IDockviewPanelProps<{ projectId: string }>) => (
    <ChannelPanel
      panelId={props.api.id}
      projectId={props.params.projectId}
      getApi={() => props.containerApi as DockviewApi}
    />
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
  kanban: () => <KanbanPanel />,
};

interface WorkspaceProps {
  project: Project;
  /** dockview api 준비 시 App 에 노출 — 레일·검색·프리뷰가 패널 추가에 사용 */
  onApiReady: (api: DockviewApi) => void;
}

type DropKind = 'tab' | 'left' | 'right' | 'top' | 'bottom';

function computeDropZone(e: React.DragEvent, rect: DOMRect): DropKind {
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const w = rect.width, h = rect.height;
  if (w <= 0 || h <= 0) return 'tab';
  const dl = x / w;
  const dr = (w - x) / w;
  const dt = y / h;
  const db = (h - y) / h;
  const EDGE = 0.22;
  const minD = Math.min(dl, dr, dt, db);
  if (minD > EDGE) return 'tab';
  if (minD === dl) return 'left';
  if (minD === dr) return 'right';
  if (minD === dt) return 'top';
  return 'bottom';
}

export function Workspace({ project, onApiReady }: WorkspaceProps) {
  const { saveLayout, addTab, closeTab, setActiveTab, renameTab } = useProjects();
  const dockBoxRef = useRef<HTMLDivElement>(null);
  const [dropZone, setDropZone] = useState<DropKind | null>(null);
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
      : provider === 'codex' ? 'codex'
      : provider === 'hermes' ? 'channel' : 'chat';
    // Hermes 채널은 이 dockview 에 1개만 — 이미 있으면 활성화
    if (comp === 'channel') {
      const existing = api.panels.find((p) => p.view.contentComponent === 'channel');
      if (existing) { existing.api.setActive(); return; }
    }
    const label = provider === 'claude' ? 'Claude'
      : provider === 'codex' ? 'Codex'
      : provider === 'hermes' ? '# 채널' : '세션';
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

  // 파일 트리 D&D → 워크스페이스에 fileviewer 패널 (VSCode 식 방향 split)
  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-hermes-file')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const rect = dockBoxRef.current?.getBoundingClientRect();
    if (rect) setDropZone(computeDropZone(e, rect));
  }
  function onDragLeave() { setDropZone(null); }
  function onDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData('application/x-hermes-file');
    setDropZone(null);
    if (!raw) return;
    e.preventDefault();
    try {
      const { path, name } = JSON.parse(raw) as { path: string; name: string };
      const api = apiRef.current;
      if (!api) return;
      const rect = dockBoxRef.current?.getBoundingClientRect();
      const zone = rect ? computeDropZone(e, rect) : 'tab';
      // 같은 파일 이미 열려있으면 활성화만 (tab 모드에서만 — split 은 사용자가 명시 의도)
      if (zone === 'tab') {
        const existing = api.panels.find((p) => {
          const params = p.params as { filePath?: string } | undefined;
          return params?.filePath === path;
        });
        if (existing) { existing.api.setActive(); return; }
      }
      const active = api.activePanel;
      const direction = zone === 'left' ? 'left'
        : zone === 'right' ? 'right'
        : zone === 'top' ? 'above'
        : zone === 'bottom' ? 'below' : null;
      api.addPanel({
        id: uid('panel'),
        component: 'fileviewer',
        title: name,
        params: { filePath: path },
        ...(direction && active
          ? { position: { referencePanel: active.api.id, direction } }
          : {}),
      });
    } catch {
      // 무시
    }
  }

  return (
    <div className="workspace"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}>
      <TabBar
        tabs={project.tabs}
        activeId={project.activeTabId}
        onSwitch={(id) => setActiveTab(project.id, id)}
        onAdd={() => addTab(project.id)}
        onClose={(id) => closeTab(project.id, id)}
        onRename={(id, name) => renameTab(project.id, id, name)}
      />
      {/* key={activeTab.id} → 탭 전환 시 DockviewReact 완전 remount, 각 탭의 layout 복원 */}
      <div ref={dockBoxRef} className="workspace-dock-box">
        <DockviewReact
          key={activeTab.id}
          className={`workspace-dock dockview-theme-${
            settings.theme === 'dark' ? 'abyss' : 'light'
          }`}
          components={components}
          defaultTabComponent={PanelTab}
          onReady={onReady}
        />
        {dropZone && <div className={`drop-indicator drop-${dropZone}`} />}
      </div>
    </div>
  );
}
