// 마크다운 작업목록 체크박스 — '[ ]' / '[x]' 를 실제 체크박스 위젯으로 렌더.
// codemirror-live-markdown 에 없는 기능이라 직접 구현. (markdown 파서에 GFM 필요)

import {
  Decoration, type DecorationSet, EditorView, ViewPlugin,
  type ViewUpdate, WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  readonly from: number;
  constructor(checked: boolean, from: number) {
    super();
    this.checked = checked;
    this.from = from;
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-checkbox';
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // '[ ]' ↔ '[x]' 토글 (3글자)
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: this.checked ? '[ ]' : '[x]' },
      });
    });
    return box;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'TaskMarker') return;
        const text = view.state.doc.sliceString(node.from, node.to);
        const checked = /x/i.test(text);
        builder.add(
          node.from,
          node.from + 3,
          Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }),
        );
      },
    });
  }
  return builder.finish();
}

/** GFM 작업목록 체크박스 렌더 확장 */
export const taskCheckboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
