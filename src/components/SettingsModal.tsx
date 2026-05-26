// 설정 모달 — 세로 탭(외형/채팅/에디터/파일). 변경 즉시 적용·저장.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { FONT_OPTIONS, THEME_PRESETS, WEIGHT_OPTIONS, getPreset } from '../settings';
import { useSettings } from '../store/settings';
import {
  ACTIONS, DEFAULT_KEYMAP, keyEventToCombo,
  type ShortcutAction,
} from '../keybindings';

const TABS = [
  { id: 'appearance', label: '외형' },
  { id: 'chat', label: '채팅' },
  { id: 'editor', label: '에디터' },
  { id: 'files', label: '파일' },
  { id: 'keys', label: '단축키' },
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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const [tab, setTab] = useState('appearance');

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
                    onChange={(e) => update({ chatProvider: e.target.value as 'hermes' | 'claude' })}>
                    <option value="hermes">Hermes Agent</option>
                    <option value="claude">Claude Code (Max 구독)</option>
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
