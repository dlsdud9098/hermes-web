// 세로 프로젝트 레일. 프로젝트 = 폴더.
// 활성 프로젝트는 탭 바로 아래에 폴더 파일 트리가 펼쳐진다 (VS Code 탐색기식).

import { useProjects } from '../store/projects';
import { FileTreePanel } from './FileTree';
import type { DirEntry } from '../api/fs';

interface ProjectRailProps {
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onOpenFile: (file: DirEntry) => void;
}

export function ProjectRail({ onOpenFolder, onOpenSettings, onOpenFile }: ProjectRailProps) {
  const { projects, activeId, setActive, removeProject } = useProjects();

  return (
    <nav className="rail">
      <div className="rail-scroll">
        {projects.map((p) => (
          <div key={p.id}>
            <button
              className={`rail-tab${p.id === activeId ? ' rail-tab-active' : ''}`}
              style={{ borderLeftColor: p.id === activeId ? p.color : 'transparent' }}
              onClick={() => setActive(p.id)}
              onAuxClick={(e) => { if (e.button === 1) removeProject(p.id); }}
              title={`${p.name}\n${p.path}\n(가운데 클릭: 닫기)`}
            >
              <span className="rail-dot" style={{ background: p.color }} />
              <span className="rail-name">{p.name}</span>
            </button>
            {p.id === activeId && (
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
      <button className="rail-settings" onClick={onOpenSettings} title="설정">
        ⚙
      </button>
    </nav>
  );
}
