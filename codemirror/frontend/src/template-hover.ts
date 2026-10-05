import { hoverTooltip } from '@codemirror/view';
import { renderTemplate } from './api';
import { text } from './i18n';

/** Find a single-line expression without mistaking quoted braces for its end. */
function expressionAt(line: string, position: number): { from: number; to: number } | null {
  let from = line.indexOf('{{');
  while (from !== -1) {
    let quote = '';
    let depth = 0;
    let closed = false;
    for (let i = from + 2; i < line.length - 1; i++) {
      const char = line[i];
      if (quote) {
        if (char === '\\') i++;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && depth) depth--;
      else if (line.slice(i, i + 2) === '}}') {
        if (from <= position && position < i + 2) return { from, to: i + 2 };
        from = line.indexOf('{{', i + 2);
        closed = true;
        break;
      }
    }
    if (!closed) return null;
  }
  return null;
}

let cached: { source: string; result: string; time: number } | undefined;

export const templateHover = hoverTooltip((view, pos) => {
  if (view.state.readOnly || view.state.doc.length > 65536) return null;
  const document = view.state.doc.toString();
  // Block variables, comments and raw blocks require the full template context.
  if (document.includes('{%') || document.includes('{#')) return null;
  const line = view.state.doc.lineAt(pos);
  const range = expressionAt(line.text, pos - line.from);
  if (!range) return null;
  const source = line.text.slice(range.from, range.to);
  return {
    pos: line.from + range.from, end: line.from + range.to, above: true,
    create() {
      const dom = window.document.createElement('div');
      dom.className = 'template-tooltip';
      const label = window.document.createElement('div');
      label.textContent = text('Home Assistant · expression only · snapshot', 'Home Assistant · 이 표현식만 평가 · 실행 시점 결과');
      const output = window.document.createElement('pre');
      output.setAttribute('role', 'status');
      dom.append(label, output);
      const controller = new AbortController();
      let active = true;
      const timeout = window.setTimeout(() => controller.abort(), 16000);
      output.textContent = text('Rendering…', '렌더링 중…');
      const reuse = cached?.source === source && Date.now() - cached.time < 5000;
      const value = reuse && cached
        ? Promise.resolve(cached.result) : renderTemplate(source, controller.signal);
      void value.then(result => {
        if (!active) return;
        if (!reuse) cached = { source, result, time: Date.now() };
        output.textContent = result || text('(Empty result)', '(빈 결과)');
      }).catch(error => {
        if (!active) return;
        output.textContent = text('Render failed: ', '렌더링 실패: ') + (controller.signal.aborted
          ? text('Request timed out', '요청 시간 초과') : String(error.message || error));
      }).finally(() => clearTimeout(timeout));
      return { dom, destroy() { active = false; clearTimeout(timeout); controller.abort(); } };
    },
  };
}, { hoverTime: 700, hideOnChange: true });
