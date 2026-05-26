// 하단 상태바 — 활성 프로젝트/탭, 패널 수, chatProvider, claude_check 상태.

import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { invoke, isTauri } from '../runtime';
import { claudeRateLimit, type ClaudeRateLimit } from '../api/claudeCli';

interface ClaudeStatus {
  installed: boolean;
  logged_in: boolean;
  version: string;
  login_method: string;
}

/** "2h 30m" 또는 "방금" 형태로 남은 시간 표시 */
function fmtRemaining(unixSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = unixSec - now;
  if (diff <= 0) return '리셋됨';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface StatusBarProps {
  panelCount: number;
}

export function StatusBar({ panelCount }: StatusBarProps) {
  const { projects, activeId } = useProjects();
  const { settings } = useSettings();
  const active = projects.find((p) => p.id === activeId);
  const activeTab = active?.tabs.find((t) => t.id === active.activeTabId);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [rl, setRl] = useState<ClaudeRateLimit | null>(null);
  const [rlLoading, setRlLoading] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    invoke<ClaudeStatus>('claude_check')
      .then((s) => { if (!cancelled) setClaude(s); })
      .catch(() => { /* 무시 — 상태바는 best-effort */ });
    return () => { cancelled = true; };
  }, []);

  // Claude provider 활성 + 로그인 됨일 때만 rate limit 조회 (캐시 안에서)
  useEffect(() => {
    if (!isTauri) return;
    if (settings.chatProvider !== 'claude') return;
    if (!claude?.logged_in) return;
    let cancelled = false;
    setRlLoading(true);
    claudeRateLimit(false)
      .then((r) => { if (!cancelled) setRl(r); })
      .finally(() => { if (!cancelled) setRlLoading(false); });
    return () => { cancelled = true; };
  }, [settings.chatProvider, claude?.logged_in]);

  async function refreshRl() {
    setRlLoading(true);
    const r = await claudeRateLimit(true);
    setRl(r);
    setRlLoading(false);
  }

  const ok = claude?.installed && claude?.logged_in;
  const claudeTitle = claude
    ? `Claude: installed=${claude.installed} logged_in=${claude.logged_in}${claude.version ? ' · ' + claude.version : ''}`
    : 'Claude: 점검 중';

  return (
    <div className="statusbar">
      {active ? (
        <>
          <span className="statusbar-item" title={active.path}>
            <span className="statusbar-dot" style={{ background: active.color }} />
            {active.name}
          </span>
          {activeTab && <span className="statusbar-item">📑 {activeTab.name}</span>}
        </>
      ) : (
        <span className="statusbar-item statusbar-dim">프로젝트 없음</span>
      )}
      <span className="statusbar-item">패널 {panelCount}</span>
      <span className="statusbar-item">
        {settings.chatProvider === 'claude' ? 'Claude'
          : settings.chatProvider === 'codex' ? 'Codex' : 'Hermes'}
      </span>
      <span className="statusbar-spacer" />
      {settings.chatProvider === 'claude' && (
        <>
          <span
            className="statusbar-item statusbar-clickable"
            title={rl ? `${rl.status} · ${rl.rate_limit_type} · 리셋 ${new Date(rl.resets_at * 1000).toLocaleTimeString()}` : 'rate limit 미조회'}
            onClick={() => void refreshRl()}
          >
            {rlLoading ? '⌛ 조회 중'
              : rl ? `Max ${rl.status === 'allowed' ? '✓' : '⚠'} ${fmtRemaining(rl.resets_at)} 남음`
              : 'Max ?'}
          </span>
          <span className="statusbar-item" title={claudeTitle}>
            <span
              className="statusbar-dot"
              style={{ background: ok ? '#9ece6a' : '#f7768e' }}
            />
            Claude CLI
          </span>
        </>
      )}
    </div>
  );
}
