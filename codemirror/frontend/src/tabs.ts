import type { EditorSnapshot } from './editor';
import { translate } from './i18n';

export interface DocumentTab { root: string; path: string; modified: boolean; snapshot: EditorSnapshot | null }
export const tabKey = (root: string, path: string): string => root + '/' + path;

export function createTabs(open: (path: string, root: string) => Promise<void>, close: (key: string) => Promise<void>) {
  const tabs = new Map<string, DocumentTab>();
  const container = document.getElementById('document-tabs')!;
  let active = '';
  function render() {
    const focused = container.contains(document.activeElement) ? document.activeElement?.getAttribute('data-key') : null;
    container.replaceChildren();
    for (const [key, tab] of tabs) {
      const wrapper = document.createElement('div'); wrapper.className = 'document-tab' + (key === active ? ' active' : '');
      const button = document.createElement('button'); button.type = 'button'; button.role = 'tab';
      button.dataset.key = key; button.id = 'tab-' + encodeURIComponent(key); button.setAttribute('aria-controls', 'editor-split');
      button.setAttribute('aria-selected', String(key === active)); button.tabIndex = key === active ? 0 : -1;
      button.title = '/' + key;
      button.textContent = (tab.path.split('/').pop() || tab.path) + (tab.modified ? ' •' : '');
      button.addEventListener('click', () => void open(tab.path, tab.root));
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'close-tab';
      dismiss.textContent = '×'; dismiss.setAttribute('aria-label', translate('Close tab') + ': /' + key);
      dismiss.addEventListener('click', () => void close(key));
      wrapper.append(button, dismiss); container.append(wrapper);
    }
    if (focused) Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.dataset.key === focused)?.focus();
    const current = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.dataset.key === active);
    current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.getElementById('editor-split')!.setAttribute('aria-labelledby', current?.id || 'current-filename');
  }
  container.addEventListener('keydown', event => {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus(); buttons[next]?.click();
    } else if (event.key === 'Delete') { event.preventDefault(); void close(buttons[index].dataset.key!); }
  });
  window.addEventListener('language-changed', render);
  return { tabs, render, activate(key: string) { active = key; render(); } };
}
