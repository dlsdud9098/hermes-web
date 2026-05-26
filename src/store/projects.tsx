// 전역 상태 — 프로젝트 목록 / 활성 프로젝트 / 패널별 메시지.
// 프로젝트 = 폴더. 폴더를 열면 프로젝트가 생기고 이름은 폴더명에서 자동 도출된다.
// localStorage 에 영속화 — 새로고침해도 프로젝트·패널 레이아웃·메시지 유지.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, Project, ProjectTab } from '../types';

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
  /** 현재 활성 탭의 dockview 레이아웃 영속화 */
  saveLayout: (projectId: string, tabId: string, layout: unknown) => void;
  /** 프로젝트에 새 탭 추가하고 활성화 */
  addTab: (projectId: string) => string;
  /** 탭 닫기 — 마지막 탭이면 새 빈 탭으로 대체 */
  closeTab: (projectId: string, tabId: string) => void;
  /** 탭 활성화 */
  setActiveTab: (projectId: string, tabId: string) => void;
  /** 탭 이름 변경 */
  renameTab: (projectId: string, tabId: string, name: string) => void;
  setMessages: (panelId: string, messages: ChatMessage[]) => void;
  /** 프로젝트의 가장 최근 활성 탭(현재 활성 직전)으로 토글. 없으면 무시 */
  cycleRecentTab: (projectId: string) => void;
}

interface PersistedState {
  projects: Project[];
  activeId: string;
  messages: Record<string, ChatMessage[]>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function makeTab(name: string = '탭 1'): ProjectTab {
  return { id: uid('tab'), name, layout: null };
}

function makeProject(path: string): Project {
  const tab = makeTab('탭 1');
  return {
    id: uid('proj'),
    name: basename(path),
    path,
    color: COLORS[seq % COLORS.length],
    tabs: [tab],
    activeTabId: tab.id,
  };
}

/** 옛 Project (layout 단일 필드) → 새 구조 (tabs[]) 마이그레이션 */
function migrateProject(p: Project): Project {
  if (Array.isArray(p.tabs) && p.tabs.length > 0 && p.activeTabId) return p;
  const tab: ProjectTab = {
    id: uid('tab'),
    name: '탭 1',
    layout: (p as { layout?: unknown }).layout ?? null,
  };
  return { ...p, tabs: [tab], activeTabId: tab.id };
}

/** localStorage 에서 상태 복원. 손상/없음이면 null */
function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.projects)) return null;
    const projects = parsed.projects.map(migrateProject);
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
  // 프로젝트별 최근 활성 탭 스택 (MRU). 영속화 안 함 — 세션 한정
  const recentTabsRef = useRef<Record<string, string[]>>({});

  /** projectId 의 MRU 스택 맨 위에 tabId 푸시 (중복 제거, 최대 10개) */
  const pushRecent = useCallback((projectId: string, tabId: string) => {
    const stacks = recentTabsRef.current;
    const prev = stacks[projectId] ?? [];
    const next = [tabId, ...prev.filter((id) => id !== tabId)].slice(0, 10);
    stacks[projectId] = next;
  }, []);

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

  const saveLayout = useCallback((projectId: string, tabId: string, layout: unknown) => {
    setProjects((prev) =>
      prev.map((p) => p.id === projectId
        ? { ...p, tabs: p.tabs.map((t) => t.id === tabId ? { ...t, layout } : t) }
        : p,
      ),
    );
  }, []);

  const addTab = useCallback((projectId: string): string => {
    const tab = makeTab();
    setProjects((prev) => prev.map((p) => {
      if (p.id !== projectId) return p;
      const nextTabs = [...p.tabs, tab];
      const name = `탭 ${nextTabs.length}`;
      return { ...p, tabs: nextTabs.map((t) => t.id === tab.id ? { ...t, name } : t), activeTabId: tab.id };
    }));
    return tab.id;
  }, []);

  const closeTab = useCallback((projectId: string, tabId: string) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== projectId) return p;
      const remaining = p.tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        // 마지막 탭이면 새 빈 탭으로 대체
        const fresh = makeTab('탭 1');
        return { ...p, tabs: [fresh], activeTabId: fresh.id };
      }
      const nextActive = p.activeTabId === tabId
        ? remaining[Math.min(p.tabs.findIndex((t) => t.id === tabId), remaining.length - 1)].id
        : p.activeTabId;
      return { ...p, tabs: remaining, activeTabId: nextActive };
    }));
  }, []);

  const setActiveTab = useCallback((projectId: string, tabId: string) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== projectId || !p.tabs.some((t) => t.id === tabId)) return p;
      // 직전 활성 탭을 MRU 스택에 푸시 (현재 활성 직전 탭이 cycle 의 타깃이 된다)
      if (p.activeTabId && p.activeTabId !== tabId) {
        pushRecent(projectId, p.activeTabId);
      }
      return { ...p, activeTabId: tabId };
    }));
  }, [pushRecent]);

  const cycleRecentTab = useCallback((projectId: string) => {
    const stack = recentTabsRef.current[projectId] ?? [];
    if (stack.length === 0) return;
    // 스택의 맨 위가 직전 탭 — 현재 활성과 다를 때만 전환
    setProjects((prev) => prev.map((p) => {
      if (p.id !== projectId) return p;
      const target = stack.find((id) => id !== p.activeTabId && p.tabs.some((t) => t.id === id));
      if (!target) return p;
      if (p.activeTabId) pushRecent(projectId, p.activeTabId);
      return { ...p, activeTabId: target };
    }));
  }, [pushRecent]);

  const renameTab = useCallback((projectId: string, tabId: string, name: string) => {
    setProjects((prev) => prev.map((p) => p.id === projectId
      ? { ...p, tabs: p.tabs.map((t) => t.id === tabId ? { ...t, name } : t) }
      : p,
    ));
  }, []);

  const setMessages = useCallback((panelId: string, msgs: ChatMessage[]) => {
    setMessagesState((prev) => ({ ...prev, [panelId]: msgs }));
  }, []);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects, activeId, messages,
      openProject, removeProject, setActive, saveLayout,
      addTab, closeTab, setActiveTab, renameTab, setMessages, cycleRecentTab,
    }),
    [projects, activeId, messages, openProject, removeProject, setActive, saveLayout,
     addTab, closeTab, setActiveTab, renameTab, setMessages, cycleRecentTab],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}

export { uid };
