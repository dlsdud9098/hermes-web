// 전역 상태 — 프로젝트 목록 / 활성 프로젝트 / 패널별 메시지.
// 프로젝트 = 폴더. 폴더를 열면 프로젝트가 생기고 이름은 폴더명에서 자동 도출된다.
// localStorage 에 영속화 — 새로고침해도 프로젝트·패널 레이아웃·메시지 유지.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, Project } from '../types';

const COLORS = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff'];
const STORAGE_KEY = 'hermes-web:state:v1';

let seq = 0;
const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${seq++}`;

/** 절대경로에서 폴더명만 추출 — 프로젝트 표시 이름으로 쓴다 */
function basename(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (path || '프로젝트');
}

interface ProjectsContextValue {
  projects: Project[];
  activeId: string;
  messages: Record<string, ChatMessage[]>;
  /** 폴더 경로로 프로젝트를 연다. 이름은 폴더명에서 자동 도출 */
  openProject: (path: string) => void;
  removeProject: (id: string) => void;
  setActive: (id: string) => void;
  saveLayout: (projectId: string, layout: unknown) => void;
  setMessages: (panelId: string, messages: ChatMessage[]) => void;
}

interface PersistedState {
  projects: Project[];
  activeId: string;
  messages: Record<string, ChatMessage[]>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function makeProject(path: string): Project {
  return {
    id: uid('proj'),
    name: basename(path),
    path,
    color: COLORS[seq % COLORS.length],
    layout: null,
  };
}

/** localStorage 에서 상태 복원. 손상/없음이면 null */
function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.projects)) return null;
    const projects = parsed.projects;
    const activeId = projects.some((p) => p.id === parsed.activeId)
      ? (parsed.activeId as string)
      : (projects[0]?.id ?? '');
    return { projects, activeId, messages: parsed.messages ?? {} };
  } catch {
    return null;
  }
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [restored] = useState<PersistedState | null>(() => loadState());
  // 첫 실행(미복원)이면 프로젝트 없음 — 폴더를 열어야 시작
  const [projects, setProjects] = useState<Project[]>(() => restored?.projects ?? []);
  const [activeId, setActiveId] = useState<string>(() => restored?.activeId ?? '');
  const [messages, setMessagesState] = useState<Record<string, ChatMessage[]>>(
    () => restored?.messages ?? {},
  );

  // 변경 시마다 localStorage 동기화
  useEffect(() => {
    try {
      const state: PersistedState = { projects, activeId, messages };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 용량 초과 / 비활성화 — 무시 (영속화 실패해도 앱은 동작)
    }
  }, [projects, activeId, messages]);

  const openProject = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const project = makeProject(trimmed);
    setProjects((prev) => [...prev, project]);
    setActiveId(project.id);
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      setActiveId((cur) => (cur === id ? (next[0]?.id ?? '') : cur));
      return next;
    });
  }, []);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const saveLayout = useCallback((projectId: string, layout: unknown) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, layout } : p)),
    );
  }, []);

  const setMessages = useCallback((panelId: string, msgs: ChatMessage[]) => {
    setMessagesState((prev) => ({ ...prev, [panelId]: msgs }));
  }, []);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects, activeId, messages,
      openProject, removeProject, setActive, saveLayout, setMessages,
    }),
    [projects, activeId, messages, openProject, removeProject, setActive, saveLayout, setMessages],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}

export { uid };
