import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** Render inert Markdown; embedded resources cannot contact HA or external sites. */
export function renderMarkdown(target: HTMLElement, source: string): void {
  const fragment = DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }), {
    USE_PROFILES: { html: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['img', 'video', 'audio', 'source', 'style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'id', 'name', 'class'],
  });
  fragment.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) link.removeAttribute('href');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  target.replaceChildren(fragment);
}

export function initMarkdownPreview(getContent: () => string) {
  const button = document.getElementById('preview-btn') as HTMLButtonElement;
  const preview = document.getElementById('markdown-preview')!;
  const split = document.getElementById('editor-split')!;
  let markdown = false;
  let timer: number | undefined;
  function render() {
    if (markdown && !preview.hidden) renderMarkdown(preview, getContent());
  }
  button.addEventListener('click', () => {
    preview.hidden = !preview.hidden;
    split.classList.toggle('with-preview', !preview.hidden);
    button.setAttribute('aria-pressed', String(!preview.hidden));
    render();
  });
  window.addEventListener('editor-changed', () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 150);
  });
  return (filename: string | null) => {
    markdown = !!filename && /\.(md|markdown)$/i.test(filename);
    button.hidden = !markdown;
    preview.hidden = true;
    preview.replaceChildren();
    split.classList.remove('with-preview');
    button.setAttribute('aria-pressed', 'false');
  };
}
