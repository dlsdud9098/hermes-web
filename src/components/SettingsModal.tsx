// 설정 모달 — 세로 탭(외형/채팅/에디터/파일). 변경 즉시 적용·저장.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { FONT_OPTIONS, WEIGHT_OPTIONS } from '../settings';
import { useSettings } from '../store/settings';

const TABS = [
  { id: 'appearance', label: '외형' },
  { id: 'chat', label: '채팅' },
  { id: 'editor', label: '에디터' },
  { id: 'files', label: '파일' },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      {children}
    </label>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const [tab, setTab] = useState('appearance');

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
                <Row label="테마">
                  <select value={settings.theme}
                    onChange={(e) => update({ theme: e.target.value as 'light' | 'dark' })}>
                    <option value="light">라이트</option>
                    <option value="dark">다크</option>
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
          </div>
        </div>
      </div>
    </div>
  );
}
