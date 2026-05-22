// 게이트웨이 호스트 디렉토리 탐색 — vite 개발 미들웨어(/fs/list)를 호출한다.

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  /** 현재 디렉토리 절대경로 */
  path: string;
  /** 상위 디렉토리. 루트면 null */
  parent: string | null;
  /** 하위 디렉토리들 (숨김 제외, 이름순) */
  dirs: DirEntry[];
}

/** 디렉토리 목록 조회. path 생략 시 홈 디렉토리 */
export async function listDir(dirPath?: string): Promise<DirListing> {
  const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  const res = await fetch(`/fs/list${query}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `디렉토리 조회 실패 (${res.status})`);
  }
  return res.json() as Promise<DirListing>;
}
