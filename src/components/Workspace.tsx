// 한 프로젝트의 작업 공간 — dockview 도킹 레이아웃. 패널 = Hermes 세션.
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
import { FileTreePanel } from './FileTree';
import { FileViewerPanel } from './FileViewer';
import { SessionHistoryPanel } from './SessionHistory';
import { useProjects, uid } from '../store/projects';
import type { Project } from '../types';
import type { DirEntry } from '../api/fs';

interface ChatParams { projectId: string }
interface TreeParams { rootPath: string }
interface ViewerParams { filePath: string }

const components = {
  chat: (props: IDockviewPanelProps<ChatParams>) => (
    <ChatPanel panelId={props.api.id} projectId={props.params.projectId} />
  ),
  filetree: (props: IDockviewPanelProps<TreeParams>) => (
    <FileTreePanel
      rootPath={props.params.rootPath}
      onOpenFile={(file: DirEntry) => props.containerApi.addPanel({
        id: uid('panel'),
        component: 'fileviewer',
        title: file.name,
        params: { filePath: file.path },
      })}
    />
  ),
  fileviewer: (props: IDockviewPanelProps<ViewerParams>) => (
    <FileViewerPanel filePath={props.params.filePath} />
  ),
  sessionhistory: (props: IDockviewPanelProps<ChatParams>) => (
    <SessionHistoryPanel
      projectId={props.params.projectId}
      onOpenSession={(panelId, title) => {
        const existing = props.containerApi.getPanel(panelId);
        if (existing) {
          existing.focus();
          return;
        }
        props.containerApi.addPanel({
          id: panelId,
          component: 'chat',
          title: title.slice(0, 24) || '세션',
          params: { projectId: props.params.projectId },
        });
      }}
    />
  ),
};

export function Workspace({ project }: { project: Project }) {
  const { saveLayout } = useProjects();
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
  }, [project.id, project.layout, saveLayout, seed]);

  // mode 'tab' → 활성 그룹에 탭으로 추가 / 'split' → 오른쪽으로 세로 분할
  const addSession = useCallback((mode: 'tab' | 'split') => {
    const api = apiRef.current;
    if (!api) return;
    api.addPanel({
      id: uid('panel'),
      component: 'chat',
      title: `세션 ${counterRef.current++}`,
      params: { projectId: project.id },
      ...(mode === 'split'
        ? { position: { direction: 'right' as const } }
        : {}),
    });
  }, [project.id]);

  // 프로젝트 폴더 파일 트리를 왼쪽 패널로 연다
  const addFileTree = useCallback(() => {
    apiRef.current?.addPanel({
      id: uid('panel'),
      component: 'filetree',
      title: '파일',
      params: { rootPath: project.path },
      position: { direction: 'left' as const },
    });
  }, [project.path]);

  // 세션 히스토리 패널을 왼쪽에 연다
  const addSessionHistory = useCallback(() => {
    apiRef.current?.addPanel({
      id: uid('panel'),
      component: 'sessionhistory',
      title: '세션',
      params: { projectId: project.id },
      position: { direction: 'left' as const },
    });
  }, [project.id]);

  return (
    <div className="workspace">
      <div className="workspace-bar">
        <span className="workspace-title" style={{ color: project.color }} title={project.path}>
          {project.name}
        </span>
        <div className="workspace-actions">
          <button className="btn btn-ghost" onClick={addSessionHistory}>
            세션
          </button>
          <button className="btn btn-ghost" onClick={addFileTree}>
            파일트리
          </button>
          <button className="btn btn-ghost" onClick={() => addSession('tab')}>
            + 탭
          </button>
          <button className="btn btn-ghost" onClick={() => addSession('split')}>
            + 분할
          </button>
        </div>
      </div>
      <DockviewReact
        className="dockview-theme-light workspace-dock"
        components={components}
        defaultTabComponent={PanelTab}
        onReady={onReady}
      />
    </div>
  );
}
