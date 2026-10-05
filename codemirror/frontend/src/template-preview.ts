import type { EditorView } from '@codemirror/view';
import { renderTemplate } from './api';
import { text } from './i18n';

/** Render the current unsaved selection (or document) only on explicit request. */
export function initTemplatePreview(view: EditorView, available: () => boolean): () => void {
  const button = document.getElementById('template-btn') as HTMLButtonElement;
  const panel = document.getElementById('template-preview')!;
  const result = document.getElementById('template-result')!;
  const scope = document.getElementById('template-scope')!;
  const run = document.getElementById('template-run') as HTMLButtonElement;
  const close = document.getElementById('template-close') as HTMLButtonElement;
  let controller: AbortController | undefined;
  let revision = 0;

  function invalidate() {
    revision++;
    controller?.abort();
    controller = undefined;
    run.disabled = false;
    result.setAttribute('aria-busy', 'false');
    result.classList.remove('error');
  }
  async function render() {
    if (!available()) return;
    invalidate();
    const id = revision;
    const { doc, selection } = view.state;
    const selected = !selection.main.empty;
    const source = selected ? doc.sliceString(selection.main.from, selection.main.to) : doc.toString();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    scope.textContent = selected ? text('Selection', '선택 영역') : text('Entire document', '전체 문서');
    if (!source.trim()) {
      result.textContent = text('Select or enter a template first.', '먼저 템플릿을 입력하거나 선택하세요.');
      return;
    }
    controller = new AbortController();
    const request = controller;
    const timeout = window.setTimeout(() => request.abort(), 16000);
    run.disabled = true;
    result.setAttribute('aria-busy', 'true');
    result.textContent = text('Rendering with Home Assistant…', 'Home Assistant에서 렌더링 중…');
    try {
      const output = await renderTemplate(source, request.signal);
      if (id === revision) result.textContent = output || text('(Empty result)', '(빈 결과)');
    } catch (error) {
      if (id !== revision) return;
      result.classList.add('error');
      result.textContent = request.signal.aborted
        ? text('Rendering timed out. Run again to retry.', '렌더링 시간이 초과되었습니다. 다시 실행하세요.')
        : text('Render failed: ', '렌더링 실패: ') + (error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
      if (id === revision) {
        controller = undefined;
        run.disabled = false;
        result.setAttribute('aria-busy', 'false');
      }
    }
  }
  function reset() {
    invalidate();
    panel.hidden = true;
    result.textContent = '';
    button.setAttribute('aria-expanded', 'false');
  }
  button.addEventListener('click', () => { void render(); });
  run.addEventListener('click', () => { void render(); });
  close.addEventListener('click', () => { reset(); button.focus(); });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { reset(); button.focus(); }
  });
  window.addEventListener('editor-changed', () => {
    if (panel.hidden) return;
    invalidate();
    result.textContent = text('Document changed. Run again to update the result.', '문서가 변경되었습니다. 결과를 보려면 다시 실행하세요.');
  });
  return reset;
}
