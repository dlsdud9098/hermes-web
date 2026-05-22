// 설정 모달 — 세로 탭 레이아웃. 변경은 즉시 적용·저장.

import { useState } from 'react';
import {
  loadSettings, saveSettings, applySettings,
  FONT_OPTIONS, WEIGHT_OPTIONS, type Settings,
} from '../settings';

const TABS = [{ id: 'appearance', label: '외형' }];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('appearance');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    applySettings(next); // 즉시 미리보기
    saveSettings(next);  // 즉시 영속
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
                <label className="settings-row">
                  <span className="settings-label">폰트</span>
                  <select
                    value={settings.fontFamily}
                    onChange={(e) => update({ fontFamily: e.target.value })}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-row">
                  <span className="settings-label">글씨 크기</span>
                  <span className="settings-inline">
                    <input
                      type="range"
                      min={10}
                      max={22}
                      value={settings.fontSize}
                      onChange={(e) => update({ fontSize: Number(e.target.value) })}
                    />
                    <span className="settings-val">{settings.fontSize}px</span>
                  </span>
                </label>
                <label className="settings-row">
                  <span className="settings-label">굵기</span>
                  <select
                    value={settings.fontWeight}
                    onChange={(e) => update({ fontWeight: Number(e.target.value) })}
                  >
                    {WEIGHT_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>{w.label}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
