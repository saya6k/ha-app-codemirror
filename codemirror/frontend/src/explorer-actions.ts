import { entryAction } from './api';
import { text } from './i18n';

type Entry = { root: string; path: string; type: 'file' | 'directory' };
interface Actions {
  selection(): Entry[];
  select(path: string): void;
  folder(): { root: string; folder: string };
  busy(): boolean;
  setBusy(value: boolean): void;
  canChange(source: string): boolean;
  changed(source: string, target?: string): Promise<void>;
  refresh(): Promise<void>;
  status(message: string): void;
  error(message: string): void;
}

export function initExplorerActions(actions: Actions): void {
  const tree = document.getElementById('file-list')!;
  const menu = document.getElementById('file-context-menu')!;
  const more = document.getElementById('explorer-menu-btn')!;
  let clipboard: { entries: Entry[]; cut: boolean } | null = null;
  let returnFocus: HTMLElement = more;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const full = (entry: Entry) => entry.root + (entry.path ? '/' + entry.path : '');
  const selected = (item: HTMLElement) => item.getAttribute('aria-selected') === 'true';
  const close = (focus = false) => { menu.hidden = true; if (focus && returnFocus.isConnected) returnFocus.focus(); };
  function show(x: number, y: number, anchor: HTMLElement) {
    if (actions.busy()) return;
    returnFocus = anchor;
    const entries = actions.selection();
    for (const id of ['delete-entry-btn', 'cut-entry-btn', 'copy-entry-btn']) button(id).disabled = entries.some(entry => !entry.path);
    button('rename-entry-btn').disabled = entries.length !== 1 || !entries[0].path;
    button('paste-entry-btn').disabled = !clipboard;
    menu.hidden = false;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4)) + 'px';
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  tree.addEventListener('contextmenu', event => {
    event.preventDefault();
    const item = (event.target as HTMLElement).closest<HTMLElement>('.tree-item');
    if (item?.dataset.path && !selected(item)) actions.select(item.dataset.path);
    show(event.clientX, event.clientY, item || more);
  });
  more.addEventListener('click', () => {
    const rect = more.getBoundingClientRect();
    show(rect.left, rect.bottom, more);
  });
  tree.addEventListener('keydown', event => {
    const shortcut = (event.ctrlKey || event.metaKey) && ['c', 'x', 'v'].includes(event.key.toLowerCase());
    if (!shortcut && !['ContextMenu', 'F2', 'Delete'].includes(event.key) && !(event.shiftKey && event.key === 'F10')) return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('.tree-item');
    if (!item?.dataset.path) return;
    if (event.key === 'F2' || !selected(item)) actions.select(item.dataset.path);
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault(); const rect = item.getBoundingClientRect(); show(rect.left + 20, rect.bottom, item);
    } else if (event.key === 'F2') { event.preventDefault(); void rename(); }
    else if (event.key === 'Delete') { event.preventDefault(); void remove(); }
    else if ((event.ctrlKey || event.metaKey) && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.key.toLowerCase() === 'v') void paste(); else remember(event.key.toLowerCase() === 'x');
    }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'Tab') close();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target as Node)) close(); });
  window.addEventListener('resize', () => close());
  tree.addEventListener('scroll', () => close());
  menu.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button')) close(); });

  async function execute(items: { entry: Entry; target?: string }[], action: 'move' | 'copy' | 'delete', targetRoot?: string) {
    if (actions.busy() || !items.length || items.some(({ entry }) => !entry.path)) return false;
    if (action !== 'copy' && !items.every(({ entry }) => actions.canChange(full(entry)))) return false;
    const destination = (target?: string) => targetRoot && target ? targetRoot + '/' + target : undefined;
    const done: typeof items = [];
    let failure: unknown = null;
    actions.setBusy(true);
    try {
      for (const item of items) {
        await entryAction(item.entry.root, item.entry.path, action, targetRoot, item.target);
        done.push(item);
      }
    } catch (reason) { failure = reason; }
    try {
      await actions.refresh();
      actions.setBusy(false);
      // Earlier entries may have succeeded before a failure; their tabs still follow them.
      if (action !== 'copy') for (const { entry, target } of done) await actions.changed(full(entry), destination(target));
    } finally { actions.setBusy(false); }
    if (failure) { actions.error(failure instanceof Error ? failure.message : 'File operation failed'); return false; }
    actions.select(destination(items[0].target) ?? items[0].entry.root);
    actions.status(text('File operation completed', '파일 작업 완료'));
    return true;
  }
  function remember(cut: boolean) {
    const entries = actions.selection();
    if (actions.busy() || entries.some(entry => !entry.path)) return;
    clipboard = { entries: entries.map(entry => ({ ...entry })), cut };
    actions.status(text(cut ? 'Cut: choose a folder and paste' : 'Copied: choose a folder and paste', cut ? '잘라내기: 대상 폴더에서 붙여넣으세요' : '복사: 대상 폴더에서 붙여넣으세요'));
  }
  async function rename() {
    const entries = actions.selection();
    const entry = { ...entries[0] };
    if (actions.busy() || entries.length !== 1 || !entry.path || !actions.canChange(full(entry))) return;
    const name = window.prompt(text('New name', '새 이름'), entry.path.split('/').pop());
    if (name === null) return;
    if (!name.trim() || name === '.' || name === '..' || /[/\\]/.test(name)) { actions.error(text('Enter a name without a path', '경로 구분자 없이 이름을 입력하세요')); return; }
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) + '/' : '';
    if (parent + name === entry.path) return;
    await execute([{ entry, target: parent + name }], 'move', entry.root);
  }
  async function remove() {
    const entries = actions.selection();
    if (actions.busy() || entries.some(entry => !entry.path) || !entries.every(entry => actions.canChange(full(entry)))) return;
    const [entry] = entries;
    const question = entries.length > 1
      ? text(`Permanently delete ${entries.length} items and all their contents?`, `${entries.length}개 항목과 모든 하위 항목을 영구 삭제할까요?`)
      : text(`Permanently delete ${entry.path}${entry.type === 'directory' ? ' and all its contents' : ''}?`, `${entry.path}${entry.type === 'directory' ? ' 및 모든 하위 항목을' : '을(를)'} 영구 삭제할까요?`);
    if (!window.confirm(question)) return;
    await execute(entries.map(entry => ({ entry })), 'delete');
  }
  async function paste() {
    if (!clipboard || actions.busy()) return;
    const { entries, cut } = clipboard;
    const target = actions.folder();
    const prefix = target.folder ? target.folder + '/' : '';
    const items = entries.map(entry => ({ entry, target: prefix + entry.path.split('/').pop()! }));
    if (!cut && items.length === 1 && target.root === items[0].entry.root && items[0].target === items[0].entry.path) {
      const chosen = window.prompt(text('Name for the copy', '복사본 이름'), items[0].target.slice(prefix.length));
      if (!chosen) return;
      if (/[/\\]/.test(chosen) || chosen === '.' || chosen === '..') { actions.error('Invalid name'); return; }
      items[0].target = prefix + chosen;
    }
    if (await execute(items, cut ? 'move' : 'copy', target.root)) {
      if (cut) clipboard = null;
    }
  }
  button('rename-entry-btn').addEventListener('click', () => void rename());
  button('delete-entry-btn').addEventListener('click', () => void remove());
  button('cut-entry-btn').addEventListener('click', () => remember(true));
  button('copy-entry-btn').addEventListener('click', () => remember(false));
  button('paste-entry-btn').addEventListener('click', () => void paste());
}
