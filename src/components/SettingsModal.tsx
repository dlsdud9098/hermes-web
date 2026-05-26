// 설정 모달 — 세로 탭(외형/채팅/에디터/파일/단축키/계정). 변경 즉시 적용·저장.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FONT_OPTIONS, THEME_PRESETS, WEIGHT_OPTIONS, getPreset } from '../settings';
import { useSettings } from '../store/settings';
import {
  ACTIONS, DEFAULT_KEYMAP, keyEventToCombo,
  type ShortcutAction,
} from '../keybindings';
import {
  accountsList, accountAddCurrent, accountRemove, accountSetActive,
  accountRename, accountAutoRotateGet, accountAutoRotateSet,
  type AccountWithStatus, type AutoRotateConfig, type Provider,
} from '../api/accounts';
import { isTauri } from '../runtime';

export type SettingsTabId =
  | 'appearance' | 'chat' | 'editor' | 'files' | 'keys' | 'accounts';

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'appearance', label: '외형' },
  { id: 'chat', label: '채팅' },
  { id: 'editor', label: '에디터' },
  { id: 'files', label: '파일' },
  { id: 'keys', label: '단축키' },
  { id: 'accounts', label: '계정' },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      {children}
    </label>
  );
}

/** 단축키 한 행 — 빈 버튼 클릭 → 다음 키 입력 캡쳐 후 저장 */
function KeymapRow({
  action, label, current, onChange, onReset, conflict,
}: {
  action: ShortcutAction;
  label: string;
  current: string;
  onChange: (combo: string) => void;
  onReset: () => void;
  conflict: boolean;
}) {
  const [recording, setRecording] = useState(false);

  function startRecord() {
    setRecording(true);
    const onKey = (e: KeyboardEvent) => {
      // Esc 만 누르면 취소
      if (e.key === 'Escape') {
        e.preventDefault();
        window.removeEventListener('keydown', onKey, true);
        setRecording(false);
        return;
      }
      const combo = keyEventToCombo(e);
      if (!combo) return; // modifier-only
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      onChange(combo);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
  }

  return (
    <div className="keymap-row">
      <span className="keymap-label">{label}</span>
      <button
        className={`keymap-key${recording ? ' keymap-key-rec' : ''}${conflict ? ' keymap-key-conflict' : ''}`}
        onClick={startRecord}
        title={conflict ? '다른 액션과 충돌' : '클릭 후 단축키 입력 (Esc 취소)'}
      >
        {recording ? '키 입력…' : current}
      </button>
      {current !== DEFAULT_KEYMAP[action] && (
        <button className="btn btn-ghost keymap-reset" onClick={onReset} title="기본값으로">
          ↺
        </button>
      )}
    </div>
  );
}

export function SettingsModal({
  onClose, initialTab = 'appearance',
}: { onClose: () => void; initialTab?: SettingsTabId }) {
  const { settings, update } = useSettings();
  const [tab, setTab] = useState<SettingsTabId>(initialTab);

  // 같은 콤보를 쓰는 액션이 2개 이상이면 양쪽 빨갛게
  const conflicts = new Set<ShortcutAction>();
  {
    const seen = new Map<string, ShortcutAction>();
    for (const [id, combo] of Object.entries(settings.keymap) as [ShortcutAction, string][]) {
      const prev = seen.get(combo);
      if (prev) {
        conflicts.add(prev);
        conflicts.add(id);
      } else {
        seen.set(combo, id);
      }
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">설정</span>
          <button className="picker-x" onClick={onClose}>✕</button>
        </div>
        <div className="settings-main">
          <div className="settings-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`settings-tab${tab === t.id ? ' settings-tab-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="settings-pane">
            {tab === 'appearance' && (
              <>
                <Row label="테마 프리셋">
                  <select value={settings.themePreset}
                    onChange={(e) => {
                      const preset = getPreset(e.target.value);
                      update({
                        themePreset: preset.id,
                        theme: preset.mode,
                        accentColor: preset.vars.accent,
                      });
                    }}>
                    {THEME_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </Row>
                <Row label="폰트">
                  <select value={settings.fontFamily}
                    onChange={(e) => update({ fontFamily: e.target.value })}>
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </Row>
                <Row label="글씨 크기">
                  <span className="settings-inline">
                    <input type="range" min={10} max={22} value={settings.fontSize}
                      onChange={(e) => update({ fontSize: Number(e.target.value) })} />
                    <span className="settings-val">{settings.fontSize}px</span>
                  </span>
                </Row>
                <Row label="굵기">
                  <select value={settings.fontWeight}
                    onChange={(e) => update({ fontWeight: Number(e.target.value) })}>
                    {WEIGHT_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>{w.label}</option>
                    ))}
                  </select>
                </Row>
                <Row label="줄 간격">
                  <span className="settings-inline">
                    <input type="range" min={1.2} max={2} step={0.1} value={settings.lineHeight}
                      onChange={(e) => update({ lineHeight: Number(e.target.value) })} />
                    <span className="settings-val">{settings.lineHeight.toFixed(1)}</span>
                  </span>
                </Row>
                <Row label="강조색">
                  <input type="color" value={settings.accentColor}
                    onChange={(e) => update({ accentColor: e.target.value })} />
                </Row>
                <Row label="코드 글씨 크기">
                  <span className="settings-inline">
                    <input type="range" min={10} max={18} value={settings.codeFontSize}
                      onChange={(e) => update({ codeFontSize: Number(e.target.value) })} />
                    <span className="settings-val">{settings.codeFontSize}px</span>
                  </span>
                </Row>
              </>
            )}

            {tab === 'chat' && (
              <>
                <Row label="채팅 백엔드">
                  <select value={settings.chatProvider}
                    onChange={(e) => update({ chatProvider: e.target.value as 'hermes' | 'claude' | 'codex' })}>
                    <option value="hermes">Hermes Agent</option>
                    <option value="claude">Claude Code (Max 구독)</option>
                    <option value="codex">Codex (ChatGPT Plus/Pro)</option>
                  </select>
                </Row>
                <Row label="Enter 동작">
                  <select value={settings.enterToSend ? 'send' : 'newline'}
                    onChange={(e) => update({ enterToSend: e.target.value === 'send' })}>
                    <option value="send">Enter 전송 · Shift+Enter 줄바꿈</option>
                    <option value="newline">Enter 줄바꿈 · Shift+Enter 전송</option>
                  </select>
                </Row>
                <Row label="토큰 사용량 표시">
                  <input type="checkbox" checked={settings.showTokenUsage}
                    onChange={(e) => update({ showTokenUsage: e.target.checked })} />
                </Row>
                <Row label="소요 시간 표시">
                  <input type="checkbox" checked={settings.showTiming}
                    onChange={(e) => update({ showTiming: e.target.checked })} />
                </Row>
                <Row label="새 메시지 자동 스크롤">
                  <input type="checkbox" checked={settings.autoScroll}
                    onChange={(e) => update({ autoScroll: e.target.checked })} />
                </Row>
              </>
            )}

            {tab === 'editor' && (
              <>
                <Row label="자동 저장">
                  <input type="checkbox" checked={settings.autoSave}
                    onChange={(e) => update({ autoSave: e.target.checked })} />
                </Row>
                <Row label="줄 번호">
                  <input type="checkbox" checked={settings.lineNumbers}
                    onChange={(e) => update({ lineNumbers: e.target.checked })} />
                </Row>
                <Row label="줄바꿈(word wrap)">
                  <input type="checkbox" checked={settings.wordWrap}
                    onChange={(e) => update({ wordWrap: e.target.checked })} />
                </Row>
                <Row label="탭 크기">
                  <select value={settings.tabSize}
                    onChange={(e) => update({ tabSize: Number(e.target.value) })}>
                    <option value={2}>2칸</option>
                    <option value={4}>4칸</option>
                  </select>
                </Row>
                <Row label="마크다운 라이브 프리뷰">
                  <input type="checkbox" checked={settings.mdLivePreview}
                    onChange={(e) => update({ mdLivePreview: e.target.checked })} />
                </Row>
              </>
            )}

            {tab === 'files' && (
              <>
                <Row label="숨김 파일 표시">
                  <input type="checkbox" checked={settings.showHiddenFiles}
                    onChange={(e) => update({ showHiddenFiles: e.target.checked })} />
                </Row>
                <Row label="정렬">
                  <select value={settings.fileSortOrder}
                    onChange={(e) => update({ fileSortOrder: e.target.value as 'name-asc' | 'name-desc' })}>
                    <option value="name-asc">이름 오름차순</option>
                    <option value="name-desc">이름 내림차순</option>
                  </select>
                </Row>
              </>
            )}

            {tab === 'accounts' && <AccountsTab />}

            {tab === 'keys' && (
              <div className="keymap-list">
                <div className="keymap-hint">
                  키를 누르면 등록됨. Esc 로 취소. Ctrl+1~9(프로젝트 전환)는 고정.
                </div>
                {ACTIONS.map((a) => (
                  <KeymapRow
                    key={a.id}
                    action={a.id}
                    label={a.label}
                    current={settings.keymap[a.id]}
                    conflict={conflicts.has(a.id)}
                    onChange={(combo) => update({
                      keymap: { ...settings.keymap, [a.id]: combo },
                    })}
                    onReset={() => update({
                      keymap: { ...settings.keymap, [a.id]: DEFAULT_KEYMAP[a.id] },
                    })}
                  />
                ))}
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 12 }}
                  onClick={() => update({ keymap: { ...DEFAULT_KEYMAP } })}
                >
                  전체 기본값으로
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 계정 풀 탭 — Claude/Codex 별 계정 목록 + 자동 로테이션 설정 */
function AccountsTab() {
  const [claudeList, setClaudeList] = useState<AccountWithStatus[]>([]);
  const [codexList, setCodexList] = useState<AccountWithStatus[]>([]);
  const [rotate, setRotate] = useState<AutoRotateConfig>({ enabled: false, threshold_pct: 5 });
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    if (!isTauri) return;
    try {
      const [c, x, r] = await Promise.all([
        accountsList('claude'),
        accountsList('codex'),
        accountAutoRotateGet(),
      ]);
      setClaudeList(c);
      setCodexList(x);
      setRotate(r);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void refresh(); }, []);

  if (!isTauri) {
    return <div className="keymap-hint">계정 풀은 데스크톱 앱에서만 사용 가능합니다.</div>;
  }

  return (
    <div className="accounts-tab">
      {err && <div className="accounts-err">{err}</div>}

      <ProviderSection
        provider="claude"
        title="Claude"
        list={claudeList}
        onChanged={refresh}
      />

      <ProviderSection
        provider="codex"
        title="Codex"
        list={codexList}
        onChanged={refresh}
      />

      <div className="accounts-section">
        <div className="accounts-section-head">자동 로테이션</div>
        <div className="keymap-hint">
          현재 활성 계정의 남은 한도가 임계치 이하로 떨어지면 풀에서 여유 있는 계정으로 자동 전환.
        </div>
        <div className="accounts-rotate-toggle">
          <label className="settings-inline">
            <input
              type="checkbox"
              checked={rotate.enabled}
              onChange={async (e) => {
                const next = { ...rotate, enabled: e.target.checked };
                setRotate(next);
                try { await accountAutoRotateSet(next); }
                catch (er) { setErr(er instanceof Error ? er.message : String(er)); }
              }}
            />
            <span>활성화</span>
          </label>
          <span className="settings-inline">
            <span className="keymap-label">임계 %</span>
            <input
              type="range" min={1} max={50}
              value={rotate.threshold_pct}
              onChange={(e) => setRotate({ ...rotate, threshold_pct: Number(e.target.value) })}
              onMouseUp={async () => {
                try { await accountAutoRotateSet(rotate); }
                catch (er) { setErr(er instanceof Error ? er.message : String(er)); }
              }}
              onTouchEnd={async () => {
                try { await accountAutoRotateSet(rotate); }
                catch (er) { setErr(er instanceof Error ? er.message : String(er)); }
              }}
            />
            <span className="settings-val">{rotate.threshold_pct}%</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ProviderSection({
  provider, title, list, onChanged,
}: {
  provider: Provider;
  title: string;
  list: AccountWithStatus[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function handleAdd() {
    const label = window.prompt(
      `${title} 계정 라벨 (예: main, work)`, '',
    )?.trim();
    if (!label) return;
    setBusy(true);
    try {
      await accountAddCurrent(provider, label);
      await onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string, label: string) {
    if (!window.confirm(`'${label}' 계정을 삭제할까요? 저장된 인증 토큰이 풀에서 제거됩니다.`)) return;
    try {
      await accountRemove(provider, id);
      await onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleActivate(id: string) {
    try {
      await accountSetActive(provider, id);
      await onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRename(id: string, label: string) {
    setEditing(null);
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      await accountRename(provider, id, trimmed);
      await onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="accounts-section">
      <div className="accounts-section-head">
        <span>{title}</span>
        <button className="btn btn-ghost" disabled={busy} onClick={handleAdd}>
          현재 로그인 풀에 추가
        </button>
      </div>
      {list.length === 0 ? (
        <div className="keymap-hint">
          등록된 계정 없음. 외부 터미널에서 <code>{provider} login</code> 후
          '현재 로그인 풀에 추가' 클릭.
        </div>
      ) : (
        list.map((a) => (
          <div key={a.id} className="account-row">
            {editing === a.id ? (
              <input
                className="account-label-edit"
                defaultValue={a.label}
                autoFocus
                onBlur={(e) => void handleRename(a.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { void handleRename(a.id, e.currentTarget.value); }
                  if (e.key === 'Escape') { setEditing(null); }
                }}
              />
            ) : (
              <span
                className="account-label"
                title="더블클릭으로 이름 변경"
                onDoubleClick={() => setEditing(a.id)}
              >
                {a.label}
              </span>
            )}
            {a.is_active && <span className="account-active-badge">활성</span>}
            <span className="account-row-spacer" />
            {!a.is_active && (
              <button className="btn btn-ghost" onClick={() => void handleActivate(a.id)}>
                전환
              </button>
            )}
            <button
              className="btn btn-ghost account-del"
              onClick={() => void handleRemove(a.id, a.label)}
            >
              삭제
            </button>
          </div>
        ))
      )}
    </div>
  );
}
