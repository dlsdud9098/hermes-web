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
