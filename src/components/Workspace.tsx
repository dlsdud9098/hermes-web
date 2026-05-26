// 한 프로젝트의 작업 공간 — dockview 도킹 레이아웃. 패널 = Hermes 세션 / 파일 뷰어.
// App 에서 project.id 를 key 로 주므로 프로젝트 전환 시 remount → 레이아웃 복원.

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
import { useProjects, uid } from '../store/projects';
import { useSettings } from '../store/settings';
import type { Project } from '../types';

interface ChatParams { projectId: string }
interface ViewerParams { filePath: string }
interface SessionViewerParams { source: 'claude' | 'codex'; file: string }
interface SearchParams { projectPath: string }

/** SearchPanel 안에서 dockview 컨테이너를 알 수 없으므로 글로벌 이벤트로 파일 열기 */
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
};

interface WorkspaceProps {
  project: Project;
  /** dockview api 가 준비되면 App 에 넘긴다 (레일에서 파일 뷰어를 열기 위함) */
  onApiReady: (api: DockviewApi) => void;
}

export function Workspace({ project, onApiReady }: WorkspaceProps) {
  const { saveLayout } = useProjects();
  const { settings } = useSettings();
  const apiRef = useRef<DockviewApi | null>(null);
  const counterRef = useRef(1);

  const seed = useCallback((api: DockviewApi) => {
    api.addPanel({
      id: uid('panel'),
      component: 'chat',
      title: '세션 1',
      params: { projectId: project.id },
    });
  }, [project.id]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    onApiReady(event.api);
    if (project.layout) {
      try {
        event.api.fromJSON(project.layout as Parameters<DockviewApi['fromJSON']>[0]);
      } catch {
        seed(event.api);
      }
    } else {
      seed(event.api);
    }
    counterRef.current = event.api.panels.length + 1;

    // 레이아웃·제목 변경 모두 영속화 (제목 변경은 onDidLayoutChange 로 안 잡힘)
    const persist = () => saveLayout(project.id, event.api.toJSON());
    event.api.onDidLayoutChange(persist);
    for (const panel of event.api.panels) panel.api.onDidTitleChange(persist);
    event.api.onDidAddPanel((panel) => panel.api.onDidTitleChange(persist));
  }, [project.id, project.layout, saveLayout, seed, onApiReady]);

  // mode: 'tab' = 같은 그룹에 탭 추가 / 'right' = 가로 분할 / 'below' = 세로 분할
  const addSession = useCallback((mode: 'tab' | 'right' | 'below') => {
    const api = apiRef.current;
    if (!api) return;
    const isClaude = settings.chatProvider === 'claude';
    api.addPanel({
      id: uid('panel'),
      component: isClaude ? 'claudecode' : 'chat',
      title: `${isClaude ? 'Claude' : '세션'} ${counterRef.current++}`,
      params: { projectId: project.id },
      ...(mode === 'tab'
        ? {}
        : { position: { direction: mode as 'right' | 'below' } }),
    });
  }, [project.id, settings.chatProvider]);

  return (
    <div className="workspace">
      <div className="workspace-bar">
        <span className="workspace-title" style={{ color: project.color }} title={project.path}>
          {project.name}
        </span>
        <div className="workspace-actions">
          <button className="btn btn-ghost" onClick={() => addSession('tab')}
            title="활성 그룹에 새 탭">
            + 탭
          </button>
          <button className="btn btn-ghost" onClick={() => addSession('below')}
            title="가로선으로 분할 — 위아래 배치">
            ─ 가로 분할
          </button>
          <button className="btn btn-ghost" onClick={() => addSession('right')}
            title="세로선으로 분할 — 좌우 배치">
            │ 세로 분할
          </button>
        </div>
      </div>
      <DockviewReact
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
