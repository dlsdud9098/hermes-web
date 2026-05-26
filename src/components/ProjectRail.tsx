// 세로 프로젝트 레일. 프로젝트 = 폴더.
// 활성 프로젝트는 탭 바로 아래에 폴더 파일 트리가 펼쳐진다 (VS Code 탐색기식).

import { useProjects } from '../store/projects';
import { FileTreePanel } from './FileTree';
import type { DirEntry } from '../api/fs';

interface ProjectRailProps {
  onOpenFolder: () => void;
  onOpenFile: (file: DirEntry) => void;
  onOpenSettings: () => void;
  onOpenSessions: () => void;
  treeOpen: boolean;
  setTreeOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
}

export function ProjectRail({
  onOpenFolder, onOpenFile, onOpenSettings, onOpenSessions, treeOpen, setTreeOpen,
}: ProjectRailProps) {
  const { projects, activeId, setActive, removeProject } = useProjects();

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
    <nav className="rail">
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
      <button className="rail-settings" onClick={onOpenSessions} title="세션 기록 (Claude/Codex)">
        📜
      </button>
      <button className="rail-settings" onClick={onOpenSettings} title="설정">
        ⚙
      </button>
    </nav>
  );
}
