// 전역 상태 — 프로젝트 목록 / 활성 프로젝트 / 패널별 메시지.
// localStorage 에 영속화 — 새로고침해도 프로젝트·패널 레이아웃·메시지 유지.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, Project } from '../types';

const COLORS = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff'];
const STORAGE_KEY = 'hermes-web:state:v1';

let seq = 0;
const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${seq++}`;

interface ProjectsContextValue {
  projects: Project[];
  activeId: string;
  messages: Record<string, ChatMessage[]>;
  addProject: (name: string) => void;
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

function makeProject(name: string): Project {
  return {
    id: uid('proj'),
    name,
    color: COLORS[seq % COLORS.length],
    layout: null,
  };
}

/** localStorage 에서 상태 복원. 손상/없음/빈 목록이면 null */
function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) return null;
    const projects = parsed.projects;
    const activeId = projects.some((p) => p.id === parsed.activeId)
      ? (parsed.activeId as string)
      : projects[0].id;
    return { projects, activeId, messages: parsed.messages ?? {} };
  } catch {
    return null;
  }
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [restored] = useState<PersistedState | null>(() => loadState());
  const [projects, setProjects] = useState<Project[]>(
    () => restored?.projects ?? [makeProject('첫 프로젝트')],
  );
  const [activeId, setActiveId] = useState<string>(
    () => restored?.activeId ?? projects[0].id,
  );
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

  const addProject = useCallback((name: string) => {
    const project = makeProject(name.trim() || '새 프로젝트');
    setProjects((prev) => [...prev, project]);
    setActiveId(project.id);
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) return prev; // 최소 1개 유지
      setActiveId((cur) => (cur === id ? next[0].id : cur));
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
      addProject, removeProject, setActive, saveLayout, setMessages,
    }),
    [projects, activeId, messages, addProject, removeProject, setActive, saveLayout, setMessages],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}

export { uid };
