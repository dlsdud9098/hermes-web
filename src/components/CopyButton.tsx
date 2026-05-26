// 메시지 본문 복사 버튼 — hover 시 노출, 클릭 시 200ms '복사됨' 피드백.
// clipboard API 가 없는 환경(브라우저 비보안 컨텍스트 등) 대비 textarea fallback.

import { useState } from 'react';

interface Props {
  text: string;
  className?: string;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallthrough
    }
  }
  // fallback — hidden textarea + execCommand
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* noop */ }
  document.body.removeChild(ta);
}

export function CopyButton({ text, className }: Props) {
  const [done, setDone] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await writeClipboard(text);
    setDone(true);
    window.setTimeout(() => setDone(false), 1200);
  };
  return (
    <button
      className={`msg-copy${className ? ' ' + className : ''}`}
      onClick={onClick}
      title="복사"
    >
      {done ? '✓ 복사됨' : '⧉ 복사'}
    </button>
  );
}
