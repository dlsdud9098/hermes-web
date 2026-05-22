// 에이전트가 위험 작업 전 승인을 요청할 때 뜨는 카드.

const CHOICE_LABEL: Record<string, string> = {
  once: '이번만 허용',
  session: '세션 동안 허용',
  always: '항상 허용',
  deny: '거부',
};

interface ApprovalCardProps {
  command: string;
  description: string;
  choices: string[];
  busy: boolean;
  onChoose: (choice: string) => void;
}

export function ApprovalCard({ command, description, choices, busy, onChoose }: ApprovalCardProps) {
  return (
    <div className="approval-card">
      <div className="approval-head">⚠ 승인 필요</div>
      {description && <div className="approval-desc">{description}</div>}
      {command && <code className="approval-cmd">{command}</code>}
      <div className="approval-actions">
        {choices.map((c) => (
          <button
            key={c}
            className={`btn${c === 'deny' ? ' btn-stop' : ''}`}
            disabled={busy}
            onClick={() => onChoose(c)}
          >
            {CHOICE_LABEL[c] ?? c}
          </button>
        ))}
      </div>
    </div>
  );
}
