// 프로젝트 전체 키워드 검색 — Tauri 백엔드(search_in_dir) 호출.

import { invoke, isTauri } from '../runtime';

export interface SearchHit {
  file: string;
  line: number;
  text: string;
  match_start: number;
  match_end: number;
}

export interface SearchOpts {
  root: string;
  query: string;
  case_insensitive?: boolean;
  include_hidden?: boolean;
  max_results?: number;
}

export async function searchInDir(opts: SearchOpts): Promise<SearchHit[]> {
  if (!isTauri) {
    throw new Error('전체 검색은 Tauri 데스크톱 모드에서만 동작합니다');
  }
  return invoke<SearchHit[]>('search_in_dir', { opts });
}
