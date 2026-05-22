// 설정 모달 — Hermes 연결 정보를 런타임에 변경 (localStorage 영속).

import { useState } from 'react';
import { loadSettings, saveSettings } from '../settings';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(() => loadSettings());

  function save() {
    saveSettings(settings);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">설정</span>
          <button className="picker-x" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <label className="settings-field">
            <span>Hermes API 주소</span>
            <input
              value={settings.hermesBaseUrl}
              onChange={(e) => setSettings({ ...settings, hermesBaseUrl: e.target.value })}
              placeholder="비워두면 .env / 프록시 기본값"
            />
          </label>
          <label className="settings-field">
            <span>Hermes API 키</span>
            <input
              type="password"
              value={settings.hermesKey}
              onChange={(e) => setSettings({ ...settings, hermesKey: e.target.value })}
              placeholder="비워두면 .env 값"
            />
          </label>
          <p className="settings-note">변경은 다음 요청부터 적용됩니다.</p>
        </div>
        <div className="picker-foot">
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}
