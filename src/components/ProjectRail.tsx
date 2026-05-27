// 세로 프로젝트 레일. 프로젝트 = 폴더.
// 활성 프로젝트는 탭 바로 아래에 폴더 파일 트리가 펼쳐진다 (VS Code 탐색기식).

import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { FileTreePanel } from './FileTree';
import type { DirEntry } from '../api/fs';

interface ProjectRailProps {
  onOpenFolder: () => void;
  onOpenFile: (file: DirEntry) => void;
  onOpenSettings: () => void;
  onOpenSessions: () => void;
  onOpenKanban: () => void;
  onOpenHermesConfig: () => void;
  treeOpen: boolean;
  setTreeOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
}

const RAIL_WIDTH_KEY = 'hermes-web:rail-width';
const MIN_W = 160;
const MAX_W = 640;

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(RAIL_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return 232;
    return Math.min(MAX_W, Math.max(MIN_W, n));
  } catch { return 232; }
}

export function ProjectRail({
  onOpenFolder, onOpenFile, onOpenSettings, onOpenSessions,
  onOpenKanban, onOpenHermesConfig,
  treeOpen, setTreeOpen,
}: ProjectRailProps) {
  const { projects, activeId, setActive, removeProject } = useProjects();
  const { settings } = useSettings();
  const isHermes = settings.chatProvider === 'hermes';
  const [width, setWidth] = useState<number>(() => loadWidth());

  // 너비 변경 시 localStorage 영속 (디바운스 안 해도 가벼움)
  useEffect(() => {
    try { localStorage.setItem(RAIL_WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (mv: MouseEvent) => {
      const next = Math.min(MAX_W, Math.max(MIN_W, startW + mv.clientX - startX));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onTabClick(id: string) {
    if (id === activeId) {
      setTreeOpen((o) => !o); // 활성 프로젝트 다시 클릭 → 트리 토글
    } else {
      setActive(id);
      setTreeOpen(true); // 다른 프로젝트 → 활성 + 트리 펼침
    }
  }

  function onCloseProject(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    const ok = window.confirm(`프로젝트 닫기 — '${name}'\n탭/레이아웃은 localStorage 에서 제거됨.`);
    if (ok) removeProject(id);
  }

  return (
    <nav className="rail" style={{ width }}>
      <div className="rail-resize" onMouseDown={startResize} title="드래그로 너비 조절" />
      <div className="rail-scroll">
        {projects.map((p) => (
          <div key={p.id}>
            <div
              className={`rail-tab${p.id === activeId ? ' rail-tab-active' : ''}`}
              style={{ borderLeftColor: p.id === activeId ? p.color : 'transparent' }}
              onClick={() => onTabClick(p.id)}
              onAuxClick={(e) => { if (e.button === 1) onCloseProject(e, p.id, p.name); }}
              title={`${p.name}\n${p.path}`}
            >
              <span className="rail-dot" style={{ background: p.color }} />
              <span className="rail-name">{p.name}</span>
              <button
                className="rail-x"
                onClick={(e) => onCloseProject(e, p.id, p.name)}
                title="프로젝트 닫기"
              >
                ✕
              </button>
            </div>
            {p.id === activeId && treeOpen && (
              <div className="rail-tree">
                <FileTreePanel rootPath={p.path} onOpenFile={onOpenFile} />
              </div>
            )}
          </div>
        ))}
        <button className="rail-add" onClick={onOpenFolder} title="폴더 열기">
          +
        </button>
      </div>
      <button
        className="rail-settings"
        onClick={onOpenKanban}
        title="Kanban 보드 (Hermes tasks) — 토글"
      >
        📋
      </button>
      {isHermes && (
        <button
          className="rail-settings"
          onClick={onOpenHermesConfig}
          title="Hermes 전용 — 스킬 / 메모리"
        >
          🜲
        </button>
      )}
      <button className="rail-settings" onClick={onOpenSessions} title="세션 기록 (Claude/Codex)">
        📜
      </button>
      <button className="rail-settings" onClick={onOpenSettings} title="설정">
        ⚙
      </button>
    </nav>
  );
}
