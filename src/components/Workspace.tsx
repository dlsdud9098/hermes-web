// 한 프로젝트의 작업 공간 — cmux/tmux 모델.
//   상단: 탭 바 — 각 탭이 독립된 dockview workspace (window).
//   본문: 활성 탭의 dockview — 안에서 panel 들을 자유 분할 (pane).
// 탭 닫기 = 그 탭의 모든 panel 사라짐.

import { useCallback, useRef } from 'react';
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
import { TabBar } from './TabBar';
import { useProjects, uid } from '../store/projects';
import { useSettings } from '../store/settings';
import type { Project } from '../types';

interface ChatParams { projectId: string }
interface ViewerParams { filePath: string }
interface SessionViewerParams { source: 'claude' | 'codex'; file: string }
interface SearchParams { projectPath: string }

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
};

interface WorkspaceProps {
  project: Project;
  /** dockview api 준비 시 App 에 노출 — 레일·검색·프리뷰가 패널 추가에 사용 */
  onApiReady: (api: DockviewApi) => void;
}

export function Workspace({ project, onApiReady }: WorkspaceProps) {
  const { saveLayout, addTab, closeTab, setActiveTab, renameTab } = useProjects();
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

    counterRef.current = event.api.panels.length + 1;

    // 활성 탭 레이아웃 영속화
    const persist = () => saveLayout(project.id, activeTab.id, event.api.toJSON());
    event.api.onDidLayoutChange(persist);
    for (const panel of event.api.panels) panel.api.onDidTitleChange(persist);
    event.api.onDidAddPanel((panel) => panel.api.onDidTitleChange(persist));
  }, [project.id, activeTab.id, activeTab.layout, saveLayout, seed, onApiReady]);

  return (
    <div className="workspace">
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
