// 설치된 Hermes 스킬 목록. Tauri → invoke('fs_skills'), 브라우저 → /fs/skills.

import { invoke, isTauri } from '../runtime';

export interface Skill {
  name: string;
  description: string;
}

let cache: Skill[] | null = null;

/** 스킬 목록 조회 (최초 1회만 IO, 이후 캐시) */
export async function listSkills(): Promise<Skill[]> {
  if (cache) return cache;
  if (isTauri) {
    const data = await invoke<{ skills: Skill[] }>('fs_skills');
    cache = data.skills ?? [];
    return cache;
  }
  const res = await fetch('/fs/skills');
  if (!res.ok) throw new Error(`스킬 목록 조회 실패 (${res.status})`);
  const data = (await res.json()) as { skills: Skill[] };
  cache = data.skills ?? [];
  return cache;
}
