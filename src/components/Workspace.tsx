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

  // 파일 트리 패널 토글 (VS Code 사이드바식 3-상태):
  //  - 없음     → 왼쪽에 열고 포커스
  //  - 활성중   → 닫기
  //  - 비활성   → 포커스만 (닫지 않음)
  const toggleFileTree = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const id = `filetree-${project.id}`;
    const existing = api.getPanel(id);
    if (!existing) {
      api.addPanel({
        id,
        component: 'filetree',
        title: '파일트리',
        params: { rootPath: project.path },
        position: { direction: 'left' as const },
      });
      return;
    }
    // isActive 는 '그룹 내 활성 탭' — 단독 패널은 항상 true 라 쓸 수 없다.
    // isGroupActive 로 '그 패널의 그룹이 포커스됐는지'를 본다.
    if (existing.api.isGroupActive) {
      existing.api.close();
    } else {
      existing.focus();
    }
  }, [project.id, project.path]);

  return (
    <div className="workspace">
      <div className="workspace-bar">
        <span className="workspace-title" style={{ color: project.color }} title={project.path}>
          {project.name}
        </span>
        <div className="workspace-actions">
          <button className="btn btn-ghost" onClick={toggleFileTree}>
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
