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
import { useProjects, uid } from '../store/projects';
import type { Project } from '../types';

interface ChatParams {
  projectId: string;
}

const components = {
  chat: (props: IDockviewPanelProps<ChatParams>) => (
    <ChatPanel panelId={props.api.id} projectId={props.params.projectId} />
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
    event.api.onDidLayoutChange(() => saveLayout(project.id, event.api.toJSON()));
  }, [project.id, project.layout, saveLayout, seed]);

  const addPanel = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.addPanel({
      id: uid('panel'),
      component: 'chat',
      title: `세션 ${counterRef.current++}`,
      params: { projectId: project.id },
    });
  }, [project.id]);

  return (
    <div className="workspace">
      <div className="workspace-bar">
        <span className="workspace-title" style={{ color: project.color }}>
          {project.name}
        </span>
        <button className="btn btn-ghost" onClick={addPanel}>+ 패널</button>
      </div>
      <DockviewReact
        className="dockview-theme-abyss workspace-dock"
        components={components}
        onReady={onReady}
      />
    </div>
  );
}
