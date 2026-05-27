// 프로젝트 폴더를 트리로. 폴더 클릭 시 지연 로드.
// 숨김/정렬은 설정. 우클릭 메뉴 — 복사/잘라내기/붙여넣기/이름/삭제/새파일/새폴더/경로복사.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  listDir, fsCopy, fsMove, fsRename, fsDelete, fsMkdir, fsNewFile,
  type DirEntry, type DirListing,
} from '../api/fs';
import { useSettings } from '../store/settings';
import type { Settings } from '../settings';
import { isTauri } from '../runtime';

function arrange(entries: DirEntry[], settings: Settings): DirEntry[] {
  let out = settings.showHiddenFiles
    ? entries
    : entries.filter((e) => !e.name.startsWith('.'));
  out = [...out].sort((a, b) => a.name.localeCompare(b.name));
  if (settings.fileSortOrder === 'name-desc') out.reverse();
  return out;
}

/** 클립보드: 복사/잘라내기 대기 중인 항목 */
interface TreeClipboard {
  paths: string[];
  op: 'copy' | 'cut';
}

interface TreeMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface TreeCtx {
  clipboard: TreeClipboard | null;
  setClipboard: (c: TreeClipboard | null) => void;
  /** 트리 일부 재로드 트리거 — 디렉토리 경로별 incrementing key */
  bumpReload: (dirPath: string) => void;
  reloadKey: Record<string, number>;
  /** 전역 단일 컨텍스트 메뉴 — 새로 열면 기존 자동 대체 */
  openMenu: (state: TreeMenuState) => void;
}
const TreeContext = createContext<TreeCtx | null>(null);

function useTree(): TreeCtx {
  const c = useContext(TreeContext);
  if (!c) throw new Error('TreeContext 없음');
  return c;
}

/** 우클릭 컨텍스트 메뉴 */
interface MenuItem { label: string; run: () => void; disabled?: boolean; sep?: boolean }

function CtxMenu({ x, y, items, onClose }: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [onClose]);
  return (
    <div className="tree-menu" style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it.sep ? (
        <div key={i} className="tree-menu-sep" />
      ) : (
        <button
          key={i}
          className={`tree-menu-item${it.disabled ? ' tree-menu-disabled' : ''}`}
          disabled={it.disabled}
          onClick={() => { if (!it.disabled) { it.run(); onClose(); } }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** 메뉴 빌더 — entry 가 null 이면 빈 영역(루트) 메뉴 */
function buildMenu(opts: {
  entry: DirEntry | null;
  isDir: boolean;
  parentDir: string;        // 루트 메뉴면 rootPath
  clipboard: TreeClipboard | null;
  setClipboard: (c: TreeClipboard | null) => void;
  reload: () => void;
  reloadParent: () => void;
}): MenuItem[] {
  const { entry, isDir, parentDir, clipboard, setClipboard, reload, reloadParent } = opts;

  async function paste() {
    if (!clipboard) return;
    const dst = isDir && entry ? entry.path : parentDir;
    try {
      for (const src of clipboard.paths) {
        if (clipboard.op === 'copy') await fsCopy(src, dst);
        else await fsMove(src, dst);
      }
      if (clipboard.op === 'cut') setClipboard(null);
      if (isDir && entry) reload(); else reloadParent();
    } catch (e) {
      window.alert(`붙여넣기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function rename() {
    if (!entry) return;
    const next = window.prompt('새 이름', entry.name);
    if (!next || next === entry.name) return;
    try {
      await fsRename(entry.path, next);
      reloadParent();
    } catch (e) {
      window.alert(`이름 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function remove() {
    if (!entry) return;
    const ok = window.confirm(`'${entry.name}' 삭제? (폴더는 재귀)`);
    if (!ok) return;
    try {
      await fsDelete(entry.path);
      reloadParent();
    } catch (e) {
      window.alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function newFile() {
    const dst = isDir && entry ? entry.path : parentDir;
    const name = window.prompt('새 파일명', 'untitled.md');
    if (!name) return;
    try {
      await fsNewFile(dst, name);
      if (isDir && entry) reload(); else reloadParent();
    } catch (e) {
      window.alert(`새 파일 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function newFolder() {
    const dst = isDir && entry ? entry.path : parentDir;
    const name = window.prompt('새 폴더명', 'new-folder');
    if (!name) return;
    try {
      await fsMkdir(dst, name);
      if (isDir && entry) reload(); else reloadParent();
    } catch (e) {
      window.alert(`새 폴더 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const items: MenuItem[] = [];
  if (entry) {
    items.push(
      {
        label: '복사',
        run: () => {
          setClipboard({ paths: [entry.path], op: 'copy' });
          // 트리 내부 붙여넣기 + 시스템 클립보드 둘 다 — 외부 앱에도 바로 paste 가능
          void navigator.clipboard?.writeText(entry.path);
        },
      },
      { label: '잘라내기', run: () => setClipboard({ paths: [entry.path], op: 'cut' }) },
    );
  }
  if (clipboard) {
    items.push({
      label: `붙여넣기 (${clipboard.paths.length}개${clipboard.op === 'cut' ? ', 이동' : ''})`,
      run: paste,
    });
  }
  if (entry) {
    items.push({ label: '', sep: true, run: () => {} });
    items.push({ label: '이름 변경', run: rename });
    items.push({ label: '삭제', run: remove });
  }
  items.push({ label: '', sep: true, run: () => {} });
  items.push({ label: '새 파일', run: newFile });
  items.push({ label: '새 폴더', run: newFolder });
  return items;
}

interface DirNodeProps {
  entry: DirEntry;
  depth: number;
  onOpenFile: (file: DirEntry) => void;
  parentDir: string;
}

function DirNode({ entry, depth, onOpenFile, parentDir }: DirNodeProps) {
  const { settings } = useSettings();
  const tree = useTree();
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const expandTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setListing(await listDir(entry.path));
    } catch {
      setError(true);
    }
  }, [entry.path]);

  const localKey = tree.reloadKey[entry.path] ?? 0;
  useEffect(() => {
    if (open && localKey > 0) void reload();
  }, [localKey, open, reload]);

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

  async function expandIfClosed() {
    if (open) return;
    if (!listing) {
      try { setListing(await listDir(entry.path)); } catch { setError(true); return; }
    }
    setOpen(true);
  }

  function onCtx(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    tree.openMenu({
      x: e.clientX, y: e.clientY,
      items: buildMenu({
        entry, isDir: true, parentDir,
        clipboard: tree.clipboard,
        setClipboard: tree.setClipboard,
        reload: () => { void reload(); tree.bumpReload(entry.path); },
        reloadParent: () => tree.bumpReload(parentDir),
      }),
    });
  }

  const pad = depth * 12 + 8;
  const cutClass = tree.clipboard?.op === 'cut' && tree.clipboard.paths.includes(entry.path)
    ? ' tree-row-cut' : '';

  // 드래그 페이로드 파싱
  function readPayload(e: React.DragEvent): { path: string; name: string } | null {
    const raw = e.dataTransfer.getData('application/x-hermes-file');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  function isSelfOrDescendant(srcPath: string): boolean {
    return srcPath === entry.path || entry.path.startsWith(srcPath + '/')
      || entry.path.startsWith(srcPath + '\\');
  }

  return (
    <>
      <button
        className={`tree-row${cutClass}${dragOver ? ' tree-row-dragover' : ''}`}
        style={{ paddingLeft: pad }}
        onClick={toggle}
        onContextMenu={onCtx}
        // 드래그 시작 — 폴더 자체도 이동 가능
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData('application/x-hermes-file', JSON.stringify({
            path: entry.path, name: entry.name,
          }));
          e.dataTransfer.setData('text/plain', entry.path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        // 폴더 위에 드래그 → 폴더 안으로 들어갈 후보
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-hermes-file')) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
          // 닫혀있으면 600ms hover 후 자동 펼침 (VSCode 식 spring-load)
          if (!open && !expandTimer.current) {
            expandTimer.current = window.setTimeout(() => {
              expandTimer.current = null;
              void expandIfClosed();
            }, 600);
          }
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          setDragOver(false);
          if (expandTimer.current) {
            window.clearTimeout(expandTimer.current);
            expandTimer.current = null;
          }
        }}
        onDrop={(e) => {
          if (expandTimer.current) {
            window.clearTimeout(expandTimer.current);
            expandTimer.current = null;
          }
          setDragOver(false);
          const payload = readPayload(e);
          if (!payload) return;
          e.preventDefault();
          e.stopPropagation();
          if (isSelfOrDescendant(payload.path)) {
            window.alert('자기 자신 또는 하위로 이동 불가');
            return;
          }
          (async () => {
            try {
              await fsMove(payload.path, entry.path);
              // src 의 부모 + 이 폴더 둘 다 재로드
              const srcParent = payload.path.replace(/[/\\][^/\\]+$/, '');
              tree.bumpReload(srcParent);
              tree.bumpReload(entry.path);
              await reload();
            } catch (err) {
              window.alert(`이동 실패: ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
        }}
      >
        <span className="tree-caret">{open ? '▾' : '▸'}</span>
        <span className="tree-ic">📁</span>
        {entry.name}{error && ' ⚠'}
      </button>
      {open && listing && (
        <>
          {arrange(listing.dirs, settings).map((d) => (
            <DirNode key={d.path} entry={d} depth={depth + 1}
              onOpenFile={onOpenFile} parentDir={entry.path} />
          ))}
          {arrange(listing.files, settings).map((f) => (
            <FileRow key={f.path} entry={f} depth={depth + 1}
              onOpenFile={onOpenFile} parentDir={entry.path} />
          ))}
        </>
      )}
    </>
  );
}

function FileRow({ entry, depth, onOpenFile, parentDir }: {
  entry: DirEntry; depth: number;
  onOpenFile: (f: DirEntry) => void; parentDir: string;
}) {
  const tree = useTree();
  function onCtx(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    tree.openMenu({
      x: e.clientX, y: e.clientY,
      items: buildMenu({
        entry, isDir: false, parentDir,
        clipboard: tree.clipboard,
        setClipboard: tree.setClipboard,
        reload: () => tree.bumpReload(parentDir),
        reloadParent: () => tree.bumpReload(parentDir),
      }),
    });
  }
  const cutClass = tree.clipboard?.op === 'cut' && tree.clipboard.paths.includes(entry.path)
    ? ' tree-row-cut' : '';
  return (
    <button
      className={`tree-row tree-file${cutClass}`}
      style={{ paddingLeft: depth * 12 + 8 + 14 }}
      onClick={() => onOpenFile(entry)}
      onContextMenu={onCtx}
      // 드래그 시작 — 워크스페이스 dockview 에서 drop 받아 파일 뷰어로 연다
      draggable
      onDragStart={(e) => {
        // 두 포맷 모두 — 'application/x-hermes-file' 는 우리 자체 인식,
        // 'text/plain' 은 외부 앱 (텍스트 에디터 등) 으로 드래그 가능
        e.dataTransfer.setData('application/x-hermes-file', JSON.stringify({
          path: entry.path, name: entry.name,
        }));
        e.dataTransfer.setData('text/plain', entry.path);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <span className="tree-ic">📄</span>
      {entry.name}
    </button>
  );
}

interface FileTreePanelProps {
  rootPath: string;
  onOpenFile: (file: DirEntry) => void;
}

export function FileTreePanel({ rootPath, onOpenFile }: FileTreePanelProps) {
  const { settings } = useSettings();
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<TreeClipboard | null>(null);
  const [reloadKey, setReloadKey] = useState<Record<string, number>>({});
  // 전역 단일 메뉴 — 어디서 openMenu 호출하든 직전 메뉴는 자동 대체
  const [menu, setMenu] = useState<TreeMenuState | null>(null);

  const bumpReload = useCallback((dirPath: string) => {
    setReloadKey((prev) => ({ ...prev, [dirPath]: (prev[dirPath] ?? 0) + 1 }));
  }, []);

  const reloadRoot = useCallback(async () => {
    if (!rootPath) return;
    try { setListing(await listDir(rootPath)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      setError('프로젝트에 폴더가 지정되지 않음');
      return;
    }
    setError(null);
    void reloadRoot();
  }, [rootPath, reloadRoot]);

  const rootKey = reloadKey[rootPath] ?? 0;
  useEffect(() => { if (rootKey > 0) void reloadRoot(); }, [rootKey, reloadRoot]);

  const ctx: TreeCtx = {
    clipboard, setClipboard, bumpReload, reloadKey,
    openMenu: setMenu,
  };

  return (
    <TreeContext.Provider value={ctx}>
      <div className="filetree"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget && isTauri) {
            e.preventDefault();
            setMenu({
              x: e.clientX, y: e.clientY,
              items: buildMenu({
                entry: null, isDir: false, parentDir: rootPath,
                clipboard, setClipboard,
                reload: () => bumpReload(rootPath),
                reloadParent: () => bumpReload(rootPath),
              }),
            });
          }
        }}
        // 빈 영역 드롭 → 프로젝트 루트로 이동
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-hermes-file')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData('application/x-hermes-file');
          if (!raw) return;
          e.preventDefault();
          try {
            const { path } = JSON.parse(raw) as { path: string; name: string };
            const parent = path.replace(/[/\\][^/\\]+$/, '');
            if (parent === rootPath) return; // 이미 루트에 있음
            (async () => {
              try {
                await fsMove(path, rootPath);
                bumpReload(parent);
                bumpReload(rootPath);
              } catch (err) {
                window.alert(`이동 실패: ${err instanceof Error ? err.message : String(err)}`);
              }
            })();
          } catch { /* 무시 */ }
        }}
      >
        {error && <div className="chat-error">⚠ {error}</div>}
        {listing && (
          <>
            {arrange(listing.dirs, settings).map((d) => (
              <DirNode key={d.path} entry={d} depth={0}
                onOpenFile={onOpenFile} parentDir={rootPath} />
            ))}
            {arrange(listing.files, settings).map((f) => (
              <FileRow key={f.path} entry={f} depth={0}
                onOpenFile={onOpenFile} parentDir={rootPath} />
            ))}
          </>
        )}
        {menu && (
          <CtxMenu
            x={menu.x} y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </TreeContext.Provider>
  );
}

