// 하단 상태바 — 활성 프로젝트/탭, 패널 수, 백엔드,
// 그리고 백엔드별 구독 사용량 (Claude OAuth API / Codex chatgpt.com 비공개 엔드포인트).

import { useEffect, useRef, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { invoke, isTauri } from '../runtime';
import {
  claudeUsage, codexUsage, fmtRemaining,
  type ClaudeUsage, type CodexUsage,
} from '../api/usage';
import {
  accountsList, accountSetActive, onAccountRotated,
  type AccountWithStatus, type Provider,
} from '../api/accounts';

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
  const [cu, setCu] = useState<ClaudeUsage | null>(null);
  const [xu, setXu] = useState<CodexUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const [accounts, setAccounts] = useState<AccountWithStatus[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toastIdRef = useRef(1);

  const provider: Provider | null =
    settings.chatProvider === 'claude' ? 'claude'
    : settings.chatProvider === 'codex' ? 'codex'
    : null;

  async function reloadAccounts() {
    if (!isTauri || !provider) { setAccounts([]); return; }
    try {
      setAccounts(await accountsList(provider));
    } catch {
      setAccounts([]);
    }
  }

  useEffect(() => { void reloadAccounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider]);

  // 자동 로테이션 이벤트 → 토스트 + 목록 갱신
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void onAccountRotated((ev) => {
      const id = toastIdRef.current++;
      const text = `계정 전환: ${ev.from_label} → ${ev.to_label} (${ev.reason})`;
      setToasts((t) => [...t, { id, text }]);
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 4000);
      void reloadAccounts();
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const activeAccount = accounts.find((a) => a.is_active) ?? null;

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    invoke<ClaudeStatus>('claude_check')
      .then((s) => { if (!cancelled) setClaude(s); })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, []);

  // provider 별 사용량 fetch — 60s 캐시 + 진입/전환 시 1회
  // hermes 는 자체 quota 없음 → Codex 사용량 표시 (실용 지표)
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    if (settings.chatProvider === 'claude') {
      claudeUsage(false).then((u) => { if (!cancelled) setCu(u); });
    } else if (settings.chatProvider === 'codex' || settings.chatProvider === 'hermes') {
      codexUsage(false).then((u) => { if (!cancelled) setXu(u); });
    }
    return () => { cancelled = true; };
  }, [settings.chatProvider]);

  async function refresh() {
    if (settings.chatProvider === 'claude') {
      setLoading(true);
      setCu(await claudeUsage(true));
      setLoading(false);
    } else if (settings.chatProvider === 'codex' || settings.chatProvider === 'hermes') {
      setLoading(true);
      setXu(await codexUsage(true));
      setLoading(false);
    }
  }

  const ok = claude?.installed && claude?.logged_in;
  const claudeTitle = claude
    ? `Claude: installed=${claude.installed} logged_in=${claude.logged_in}${claude.version ? ' · ' + claude.version : ''}`
    : 'Claude: 점검 중';

  return (
    <>
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

      {provider && (
        <span
          className="statusbar-item statusbar-clickable statusbar-account"
          title="활성 계정 · 클릭하여 빠른 전환"
          onClick={() => setPopoverOpen((v) => !v)}
        >
          {provider === 'claude' ? 'Claude' : 'Codex'} ·{' '}
          {activeAccount ? activeAccount.label : '계정 없음'}
          {popoverOpen && (
            <span
              className="accounts-popover"
              onClick={(e) => e.stopPropagation()}
            >
              {accounts.length === 0 && (
                <span className="accounts-popover-empty">
                  등록된 계정 없음
                </span>
              )}
              {accounts.filter((a) => !a.is_active).map((a) => (
                <button
                  key={a.id}
                  className="accounts-popover-item"
                  onClick={async () => {
                    try {
                      await accountSetActive(provider, a.id);
                      await reloadAccounts();
                    } catch (err) {
                      window.alert(err instanceof Error ? err.message : String(err));
                    }
                    setPopoverOpen(false);
                  }}
                >
                  {a.label}
                </button>
              ))}
              <button
                className="accounts-popover-item accounts-popover-manage"
                onClick={() => {
                  setPopoverOpen(false);
                  window.dispatchEvent(new CustomEvent('hermes:open-settings', {
                    detail: { tab: 'accounts' },
                  }));
                }}
              >
                관리…
              </button>
            </span>
          )}
        </span>
      )}

      <span className="statusbar-spacer" />

      {/* Claude 사용량 */}
      {settings.chatProvider === 'claude' && cu && (
        <>
          {cu.five_hour && (
            <UsagePill
              label="5h"
              pct={cu.five_hour.utilization_pct}
              reset={cu.five_hour.seconds_until_reset}
              onClick={() => void refresh()}
              loading={loading}
            />
          )}
          {cu.seven_day && (
            <UsagePill
              label="7d"
              pct={cu.seven_day.utilization_pct}
              reset={cu.seven_day.seconds_until_reset}
              onClick={() => void refresh()}
              loading={loading}
            />
          )}
          {cu.seven_day_opus && (
            <UsagePill
              label="7d-Opus"
              pct={cu.seven_day_opus.utilization_pct}
              reset={cu.seven_day_opus.seconds_until_reset}
              onClick={() => void refresh()}
              loading={loading}
            />
          )}
        </>
      )}

      {/* Codex 사용량 */}
      {(settings.chatProvider === 'codex' || settings.chatProvider === 'hermes') && xu && (
        <>
          {xu.primary && (
            <UsagePill
              label="5h"
              pct={xu.primary.used_pct}
              reset={xu.primary.seconds_until_reset}
              onClick={() => void refresh()}
              loading={loading}
            />
          )}
          {xu.secondary && (
            <UsagePill
              label="7d"
              pct={xu.secondary.used_pct}
              reset={xu.secondary.seconds_until_reset}
              onClick={() => void refresh()}
              loading={loading}
            />
          )}
          {xu.has_credits && (
            <span className="statusbar-item" title={`Plan: ${xu.plan_type}`}>
              💳 {xu.credits_balance.toFixed(2)}
            </span>
          )}
        </>
      )}

      {/* Claude provider 활성 시 CLI 헬스 dot */}
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
    {toasts.length > 0 && (
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast">{t.text}</div>
        ))}
      </div>
    )}
    </>
  );
}

interface PillProps {
  label: string;
  pct: number;
  reset: number;
  onClick: () => void;
  loading: boolean;
}

function UsagePill({ label, pct, reset, onClick, loading }: PillProps) {
  const remaining = Math.max(0, 100 - pct);
  // 색: 남은 % 가 낮을수록 빨강
  const color = remaining <= 10 ? '#f7768e'
    : remaining <= 25 ? '#e0af68'
    : '#9ece6a';
  return (
    <span
      className="statusbar-item statusbar-clickable statusbar-usage"
      title={`${label}: ${remaining.toFixed(1)}% 남음 (${pct.toFixed(1)}% 사용) · 리셋 ${fmtRemaining(reset)} 후`}
      onClick={onClick}
    >
      {loading ? '⌛' : (
        <>
          <span className="statusbar-pill-label">{label}</span>
          {/* 막대는 남은 양 — 가득 차있다가 줄어드는 게이지 */}
          <span className="statusbar-pill-bar">
            <span
              className="statusbar-pill-fill"
              style={{ width: `${Math.min(100, remaining)}%`, background: color }}
            />
          </span>
          <span className="statusbar-pill-pct" style={{ color }}>
            {remaining.toFixed(0)}%
          </span>
          <span className="statusbar-pill-reset">{fmtRemaining(reset)}</span>
        </>
      )}
    </span>
  );
}
