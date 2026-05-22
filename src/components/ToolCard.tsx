// 에이전트 툴 호출 1건을 보여주는 카드 — 채팅 메시지 안에 인라인 표시.

import type { ToolCall } from '../types';

const STATUS_ICON: Record<ToolCall['status'], string> = {
  running: '⟳',
  done: '✓',
  error: '✗',
};

export function ToolCard({ tool }: { tool: ToolCall }) {
  return (
    <div className={`tool-card tool-${tool.status}`}>
      <span className="tool-icon">{STATUS_ICON[tool.status]}</span>
      <span className="tool-name">{tool.tool}</span>
      {tool.preview && <code className="tool-preview">{tool.preview}</code>}
      {tool.duration !== undefined && tool.status !== 'running' && (
        <span className="tool-dur">{tool.duration.toFixed(2)}s</span>
      )}
    </div>
  );
}
