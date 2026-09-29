import { entryAction } from './api';
import { text } from './i18n';

type Entry = { root: string; path: string; type: 'file' | 'directory' };
interface Actions {
  selection(): Entry;
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
  let clipboard: { entry: Entry; cut: boolean } | null = null;
  let returnFocus: HTMLElement = more;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const full = (entry: Entry) => entry.root + (entry.path ? '/' + entry.path : '');
  const close = (focus = false) => { menu.hidden = true; if (focus && returnFocus.isConnected) returnFocus.focus(); };
  function show(x: number, y: number, anchor: HTMLElement) {
    if (actions.busy()) return;
    returnFocus = anchor;
    const entry = actions.selection();
    for (const id of ['rename-entry-btn', 'delete-entry-btn', 'cut-entry-btn', 'copy-entry-btn']) button(id).disabled = !entry.path;
    button('paste-entry-btn').disabled = !clipboard;
    menu.hidden = false;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4)) + 'px';
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  tree.addEventListener('contextmenu', event => {
    event.preventDefault();
    const item = (event.target as HTMLElement).closest<HTMLElement>('.tree-item');
    if (item?.dataset.path) actions.select(item.dataset.path);
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
    actions.select(item.dataset.path);
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

  async function execute(entry: Entry, action: 'move' | 'copy' | 'delete', targetRoot?: string, targetPath?: string) {
    if (actions.busy() || !entry.path) return false;
    if (action !== 'copy' && !actions.canChange(full(entry))) return false;
    actions.setBusy(true);
    try {
      await entryAction(entry.root, entry.path, action, targetRoot, targetPath);
      await actions.refresh();
      actions.setBusy(false);
      if (action !== 'copy') await actions.changed(full(entry), targetRoot && targetPath ? targetRoot + '/' + targetPath : undefined);
      actions.select(targetRoot && targetPath ? targetRoot + '/' + targetPath : entry.root);
      actions.status(text('File operation completed', '파일 작업 완료'));
      return true;
    } catch (reason) {
      actions.error(reason instanceof Error ? reason.message : 'File operation failed');
      await actions.refresh();
      return false;
    } finally { actions.setBusy(false); }
  }
  function remember(cut: boolean) {
    if (actions.busy() || !actions.selection().path) return;
    clipboard = { entry: { ...actions.selection() }, cut };
    actions.status(text(cut ? 'Cut: choose a folder and paste' : 'Copied: choose a folder and paste', cut ? '잘라내기: 대상 폴더에서 붙여넣으세요' : '복사: 대상 폴더에서 붙여넣으세요'));
  }
  async function rename() {
    const entry = { ...actions.selection() };
    if (actions.busy() || !entry.path || !actions.canChange(full(entry))) return;
    const name = window.prompt(text('New name', '새 이름'), entry.path.split('/').pop());
    if (name === null) return;
    if (!name.trim() || name === '.' || name === '..' || /[/\\]/.test(name)) { actions.error(text('Enter a name without a path', '경로 구분자 없이 이름을 입력하세요')); return; }
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) + '/' : '';
    if (parent + name === entry.path) return;
    await execute(entry, 'move', entry.root, parent + name);
  }
  async function remove() {
    const entry = { ...actions.selection() };
    if (actions.busy() || !entry.path || !actions.canChange(full(entry))) return;
    if (!window.confirm(text(`Permanently delete ${entry.path}${entry.type === 'directory' ? ' and all its contents' : ''}?`, `${entry.path}${entry.type === 'directory' ? ' 및 모든 하위 항목을' : '을(를)'} 영구 삭제할까요?`))) return;
    await execute(entry, 'delete');
  }
  async function paste() {
    if (!clipboard || actions.busy()) return;
    const { entry, cut } = clipboard;
    const target = actions.folder();
    let name = entry.path.split('/').pop()!;
    if (!cut && target.root === entry.root && (target.folder ? target.folder + '/' : '') + name === entry.path) {
      const chosen = window.prompt(text('Name for the copy', '복사본 이름'), name);
      if (!chosen) return;
      if (/[/\\]/.test(chosen) || chosen === '.' || chosen === '..') { actions.error('Invalid name'); return; }
      name = chosen;
    }
    if (await execute(entry, cut ? 'move' : 'copy', target.root, (target.folder ? target.folder + '/' : '') + name)) {
      if (cut) clipboard = null;
    }
  }
  button('rename-entry-btn').addEventListener('click', () => void rename());
  button('delete-entry-btn').addEventListener('click', () => void remove());
  button('cut-entry-btn').addEventListener('click', () => remember(true));
  button('copy-entry-btn').addEventListener('click', () => remember(false));
  button('paste-entry-btn').addEventListener('click', () => void paste());
}
