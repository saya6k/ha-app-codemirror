import { translate } from './i18n';
import { createEntry, runHAAction, validateConfig, type HAAction } from './api';
import { getEditorFileType, validateCurrentDocument, showEntityCompletions } from './editor';
import { getEntityCount } from './autocomplete';

interface ToolbarActions {
  context(): { root: string; folder: string; file: string | null; modified: boolean };
  isBusy(): boolean;
  setBusy(value: boolean): void;
  refreshFiles(): Promise<void>;
  refreshEntities(): Promise<void>;
  openFile(path: string, root: string): Promise<void>;
  selectFolder(path: string, root: string): void;
  status(message: string, info: string, error?: boolean): void;
  details(title: string, message: string): void;
  clearDetails(): void;
}

export function initToolbar(actions: ToolbarActions): void {
  const dialog = document.getElementById('create-dialog') as HTMLDialogElement;
  const form = document.getElementById('create-form') as HTMLFormElement;
  const name = document.getElementById('create-name') as HTMLInputElement;
  const title = document.getElementById('create-title')!;
  const location = document.getElementById('create-location')!;
  const error = document.getElementById('create-error')!;
  const submit = document.getElementById('create-submit') as HTMLButtonElement;
  const cancel = document.getElementById('create-cancel') as HTMLButtonElement;
  let kind: 'file' | 'directory' = 'file';
  let destination = { root: 'config', folder: '' };
  let creating = false;

  function openCreate(type: 'file' | 'directory') {
    if (actions.isBusy()) return;
    kind = type;
    destination = actions.context();
    title.textContent = type === 'file' ? 'New file' : 'New directory';
    location.textContent = `Create in ${destination.root === 'local_apps' ? '/addons' : '/' + destination.root}${destination.folder ? '/' + destination.folder : ''}`;
    name.value = type === 'file' ? 'untitled.yaml' : '';
    name.placeholder = type === 'file' ? 'configuration.yaml' : 'new-folder';
    error.textContent = '';
    dialog.showModal();
    name.focus();
    name.select();
  }
  document.getElementById('new-file-btn')!.addEventListener('click', () => openCreate('file'));
  document.getElementById('new-directory-btn')!.addEventListener('click', () => openCreate('directory'));
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (creating) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (actions.isBusy()) return;
    creating = true;
    submit.disabled = cancel.disabled = true;
    actions.setBusy(true);
    let created: Awaited<ReturnType<typeof createEntry>> | null = null;
    try {
      created = await createEntry(destination.root, destination.folder, name.value, kind);
      await actions.refreshFiles();
      dialog.close();
      actions.status(kind === 'file' ? 'File created' : 'Directory created', created.path);
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : 'Creation failed';
    } finally {
      creating = false;
      submit.disabled = cancel.disabled = false;
      actions.setBusy(false);
    }
    if (created) {
      actions.selectFolder(kind === 'directory' ? created.path : destination.folder, destination.root);
      if (kind === 'file') await actions.openFile(created.path, destination.root);
    }
  });

  const controls: [string, 'validate' | HAAction][] = [
    ['validate-btn', 'validate'], ['reload-ha-btn', 'reload'],
    ['reload-automations-btn', 'reload-automations'], ['reload-scripts-btn', 'reload-scripts'],
    ['reload-groups-btn', 'reload-groups'], ['reload-core-btn', 'reload-core'],
    ['restart-ha-btn', 'restart'],
  ];
  const controlButtons = controls.map(([id]) =>
    document.getElementById(id) as HTMLButtonElement);
  async function run(action: 'validate' | HAAction) {
    if (actions.isBusy()) return;
    const context = actions.context();
    if (action !== 'validate' && context.modified) {
      actions.status('Save your changes before continuing', 'Home Assistant uses saved files', true);
      return;
    }
    if (action === 'restart' && !window.confirm(translate('Restart Home Assistant Core? Automations and the HA UI will be briefly unavailable.'))) return;
    actions.setBusy(true);
    controlButtons.forEach(button => { button.disabled = true; });
    actions.clearDetails();
    try {
      if (action === 'validate') {
        const fileType = context.file ? getEditorFileType(context.file) : null;
        if ((fileType === 'yaml' || fileType === 'json') && !validateCurrentDocument().isValid) {
          actions.status('Current document has syntax errors', 'Saved HA configuration was not checked', true);
          return;
        }
        actions.status('Checking saved HA configuration…', context.modified ? 'Unsaved edits are checked locally only' : '');
        const validation = await validateConfig();
        if (validation.result === 'valid') {
          actions.status('Saved HA configuration is valid', context.modified ? 'Unsaved edits: syntax checked locally; save to validate in HA' : '');
        } else {
          const message = validation.errors || 'No validation result received';
          actions.status(validation.result === 'invalid' ? 'Saved HA configuration is invalid' : 'HA validation unavailable', 'Click for details', true);
          actions.details('Home Assistant validation', message);
        }
      } else {
        actions.status(action === 'restart' ? 'Checking configuration and restarting HA…' : 'Checking configuration and reloading YAML…', '');
        const result = await runHAAction(action);
        actions.status(result.message, '');
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Request failed';
      actions.status('Home Assistant action failed', 'Click for details', true);
      actions.details('Home Assistant action failed', message);
    } finally {
      actions.setBusy(false);
      controlButtons.forEach(button => { button.disabled = false; });
    }
  }
  controls.forEach(([, action], index) => {
    controlButtons[index].addEventListener('click', () => void run(action));
  });
  document.getElementById('refresh-entities-btn')!.addEventListener('click', () => void actions.refreshEntities());
  document.getElementById('entities-btn')!.addEventListener('click', () => {
    if (actions.isBusy()) return;
    if (!getEntityCount()) actions.status('No entities available', 'Use Refresh entities to connect to Home Assistant', true);
    else if (!showEntityCompletions()) actions.status('Open a YAML file for entity suggestions', '');
  });
}
