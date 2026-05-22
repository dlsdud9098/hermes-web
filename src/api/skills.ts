// 설치된 Hermes 스킬 목록 — vite 개발 미들웨어(/fs/skills)에서 가져온다.
// 스킬은 채팅에서 '/스킬명' 슬래시 명령으로 호출된다 (Hermes 가 네이티브 처리).

export interface Skill {
  name: string;
  description: string;
}

let cache: Skill[] | null = null;

/** 스킬 목록 조회 (최초 1회만 네트워크, 이후 캐시) */
export async function listSkills(): Promise<Skill[]> {
  if (cache) return cache;
  const res = await fetch('/fs/skills');
  if (!res.ok) throw new Error(`스킬 목록 조회 실패 (${res.status})`);
  const data = (await res.json()) as { skills: Skill[] };
  cache = data.skills ?? [];
  return cache;
}
