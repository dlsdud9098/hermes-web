// 백엔드별 스킬/슬래시 명령 목록.
// hermes: ~/.hermes/skills/<n>/SKILL.md
// claude: ~/.claude/skills/<n>/SKILL.md + ~/.claude/commands/*.md + builtin
// codex:  ~/.codex/prompts/*.md + builtin

import { invoke, isTauri } from '../runtime';
import type { ChatProvider } from '../settings';

export interface Skill {
  name: string;
  description: string;
}

const cache = new Map<ChatProvider, Skill[]>();

/** 스킬 목록 조회 — provider 별 캐시 */
export async function listSkills(provider: ChatProvider): Promise<Skill[]> {
  const c = cache.get(provider);
  if (c) return c;
  if (isTauri) {
    const data = await invoke<{ skills: Skill[] }>('provider_skills', { source: provider });
    const list = data.skills ?? [];
    cache.set(provider, list);
    return list;
  }
  // 브라우저 dev — Hermes 만 미들웨어로 지원
  if (provider !== 'hermes') return [];
  const res = await fetch('/fs/skills');
  if (!res.ok) throw new Error(`스킬 목록 조회 실패 (${res.status})`);
  const data = (await res.json()) as { skills: Skill[] };
  cache.set(provider, data.skills ?? []);
  return data.skills ?? [];
}

/** 캐시 무효화 (스킬 설치/제거 후 재로드용) */
export function invalidateSkillsCache(provider?: ChatProvider): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}
