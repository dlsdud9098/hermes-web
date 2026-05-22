// 프로젝트 폴더를 트리로 보여주는 dockview 패널. 폴더는 클릭 시 지연 로드.

import { useEffect, useState } from 'react';
import { listDir, type DirEntry, type DirListing } from '../api/fs';

interface DirNodeProps {
  entry: DirEntry;
  depth: number;
  onOpenFile: (file: DirEntry) => void;
}

function DirNode({ entry, depth, onOpenFile }: DirNodeProps) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState(false);

  async function toggle() {
    if (!listing && !open) {
      try {
        setListing(await listDir(entry.path));
      } catch {
        setError(true);
        return;
      }
    }
    setOpen((o) => !o);
  }

  const pad = depth * 12 + 8;
  return (
    <>
      <button className="tree-row" style={{ paddingLeft: pad }} onClick={toggle}>
        <span className="tree-caret">{open ? '▾' : '▸'}</span>
        <span className="tree-ic">📁</span>
        {entry.name}{error && ' ⚠'}
      </button>
      {open && listing && (
        <>
          {listing.dirs.map((d) => (
            <DirNode key={d.path} entry={d} depth={depth + 1} onOpenFile={onOpenFile} />
          ))}
          {listing.files.map((f) => (
            <button
              key={f.path}
              className="tree-row tree-file"
              style={{ paddingLeft: (depth + 1) * 12 + 8 + 14 }}
              onClick={() => onOpenFile(f)}
            >
              <span className="tree-ic">📄</span>
              {f.name}
            </button>
          ))}
        </>
      )}
    </>
  );
}

interface FileTreePanelProps {
  rootPath: string;
  onOpenFile: (file: DirEntry) => void;
}

export function FileTreePanel({ rootPath, onOpenFile }: FileTreePanelProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) {
      setError('프로젝트에 폴더가 지정되지 않음');
      return;
    }
    setError(null);
    listDir(rootPath)
      .then(setListing)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [rootPath]);

  return (
    <div className="filetree">
      {error && <div className="chat-error">⚠ {error}</div>}
      {listing && (
        <>
          {listing.dirs.map((d) => (
            <DirNode key={d.path} entry={d} depth={0} onOpenFile={onOpenFile} />
          ))}
          {listing.files.map((f) => (
            <button
              key={f.path}
              className="tree-row tree-file"
              style={{ paddingLeft: 8 + 14 }}
              onClick={() => onOpenFile(f)}
            >
              <span className="tree-ic">📄</span>
              {f.name}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
