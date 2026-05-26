// 파일시스템 호출 — Tauri 환경에선 invoke(fs_*), 브라우저(vite dev)에선 /fs/* fetch.

import { invoke, isTauri } from '../runtime';

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  /** 현재 디렉토리 절대경로 */
  path: string;
  /** 상위 디렉토리. 루트면 null */
  parent: string | null;
  /** 하위 디렉토리들 (이름순) */
  dirs: DirEntry[];
  /** 파일들 (이름순) */
  files: DirEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  /** 256KB 초과로 잘렸으면 true */
  truncated: boolean;
}

/** 디렉토리 목록 조회. path 생략 시 홈 디렉토리 */
export async function listDir(dirPath?: string): Promise<DirListing> {
  if (isTauri) {
    return invoke<DirListing>('fs_list', { path: dirPath ?? null });
  }
  const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  const res = await fetch(`/fs/list${query}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `디렉토리 조회 실패 (${res.status})`);
  }
  return res.json() as Promise<DirListing>;
}

/** 파일 내용 읽기 */
export async function readFile(filePath: string): Promise<FileContent> {
  if (isTauri) {
    return invoke<FileContent>('fs_read', { path: filePath });
  }
  const res = await fetch(`/fs/read?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `파일 읽기 실패 (${res.status})`);
  }
  return res.json() as Promise<FileContent>;
}

export interface WalkEntry {
  path: string;
  name: string;
  rel: string;
}

/** 프로젝트 루트 재귀 워크 — Quick Open 용. Tauri 전용. */
export async function walkFiles(root: string, limit?: number): Promise<WalkEntry[]> {
  if (isTauri) {
    return invoke<WalkEntry[]>('fs_walk', { root, limit: limit ?? null });
  }
  throw new Error('Tauri 전용');
}

/** 파일/폴더를 다른 폴더로 복사 (이름 중복 시 자동 ' (1)' 부여). 반환=새 경로. Tauri 전용. */
export async function fsCopy(src: string, dstDir: string): Promise<string> {
  if (!isTauri) throw new Error('Tauri 전용');
  return invoke<string>('fs_copy', { src, dstDir });
}

/** 파일/폴더 이동 (=잘라내기+붙여넣기). Tauri 전용. */
export async function fsMove(src: string, dstDir: string): Promise<string> {
  if (!isTauri) throw new Error('Tauri 전용');
  return invoke<string>('fs_move', { src, dstDir });
}

/** 이름 변경 (같은 부모 폴더 안). Tauri 전용. */
export async function fsRename(src: string, newName: string): Promise<string> {
  if (!isTauri) throw new Error('Tauri 전용');
  return invoke<string>('fs_rename', { src, newName });
}

/** 파일/폴더 삭제 (폴더는 재귀). Tauri 전용. */
export async function fsDelete(path: string): Promise<void> {
  if (!isTauri) throw new Error('Tauri 전용');
  return invoke<void>('fs_delete', { path });
}

/** 새 디렉토리 생성. Tauri 전용. */
export async function fsMkdir(parent: string, name: string): Promise<string> {
  if (!isTauri) throw new Error('Tauri 전용');
  return invoke<string>('fs_mkdir', { parent, name });
}

/** 새 빈 파일 생성. Tauri 전용. */
export async function fsNewFile(parent: string, name: string): Promise<string> {
  if (!isTauri) throw new Error('Tauri 전용');
  return invoke<string>('fs_new_file', { parent, name });
}

/** 파일 내용 저장 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  if (isTauri) {
    return invoke<void>('fs_write', { path: filePath, content });
  }
  const res = await fetch('/fs/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `파일 저장 실패 (${res.status})`);
  }
}
