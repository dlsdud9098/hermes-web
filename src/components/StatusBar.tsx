// 하단 상태바 — 활성 프로젝트/탭, 패널 수, chatProvider, claude_check 상태.

import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { invoke, isTauri } from '../runtime';

interface ClaudeStatus {
  installed: boolean;
  logged_in: boolean;
  version: string;
  login_method: string;
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

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    invoke<ClaudeStatus>('claude_check')
      .then((s) => { if (!cancelled) setClaude(s); })
      .catch(() => { /* 무시 — 상태바는 best-effort */ });
    return () => { cancelled = true; };
  }, []);

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
        {settings.chatProvider === 'claude' ? 'Claude' : 'Hermes'}
      </span>
      <span className="statusbar-spacer" />
      {settings.chatProvider === 'claude' && (
        <span className="statusbar-item" title={claudeTitle}>
          <span
            className="statusbar-dot"
            style={{ background: ok ? '#9ece6a' : '#f7768e' }}
          />
          Claude CLI
        </span>
      )}
    </div>
  );
}
