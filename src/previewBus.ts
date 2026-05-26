// 파일 뷰어 ↔ HTML 프리뷰 라이브 동기화 채널.
// FileViewer 가 편집 중인 draft 를 path 별로 push, HtmlPreview 가 구독해 srcdoc 갱신.

type Listener = (content: string) => void;

const drafts = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

export function publishDraft(path: string, content: string): void {
  drafts.set(path, content);
  listeners.get(path)?.forEach((l) => l(content));
}

export function getDraft(path: string): string | undefined {
  return drafts.get(path);
}

export function subscribeDraft(path: string, fn: Listener): () => void {
  let set = listeners.get(path);
  if (!set) {
    set = new Set();
    listeners.set(path, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(path);
  };
}
