import { uploadFile, uploadFolder } from './api';
import { compressFolder, droppedFolder, type FolderEntry } from './folder-upload';

/** Folder-aware drop/picker upload with per-file errors and no silent overwrite. */
export function initUploads(getDestination: () => { root: string; folder: string }, refresh: () => Promise<void>, isBlocked: () => boolean) {
  const sidebar = document.getElementById('sidebar')!;
  const folderInput = document.getElementById('upload-folder-input') as HTMLInputElement;
  const folderButton = document.getElementById('upload-folder-btn') as HTMLButtonElement;
  const input = document.getElementById('upload-input') as HTMLInputElement;
  const button = document.getElementById('upload-btn') as HTMLButtonElement;
  const results = document.getElementById('upload-results')!;
  const hint = document.getElementById('drop-hint')!;
  let uploading = false;
  let maxBytes = 32 * 1024 * 1024;

  function report(message: string, failed = false) {
    const line = document.createElement('p');
    line.textContent = message;
    if (failed) line.className = 'error';
    results.append(line);
    return line;
  }

  const displayPath = (root: string, folder: string) => `/${root === 'local_apps' ? 'addons' : root}${folder ? '/' + folder : ''}`;

  /** The single source of truth for where a drop lands, shared by the preview and the drop. */
  function dropDestination(target: EventTarget | null) {
    const row = (target as Element | null)?.closest?.<HTMLElement>('.tree-item');
    const path = row?.dataset.path;
    if (!path) return getDestination();
    const parts = path.split('/');
    // A file row means "next to this file": use its parent directory.
    const folder = row.classList.contains('directory') ? parts.slice(1) : parts.slice(1, -1);
    return { root: parts[0], folder: folder.join('/') };
  }

  let previewKey = '';
  function preview(location: { root: string; folder: string } | null) {
    const key = location ? location.root + '/' + location.folder : '';
    if (key === previewKey) return;
    previewKey = key;
    sidebar.classList.toggle('drop-active', Boolean(location));
    sidebar.querySelectorAll('.tree-item.drop-target').forEach(row => row.classList.remove('drop-target'));
    hint.hidden = !location;
    if (!location) return;
    const path = location.folder ? `${location.root}/${location.folder}` : location.root;
    sidebar.querySelector(`.tree-item.directory[data-path="${CSS.escape(path)}"]`)?.classList.add('drop-target');
    hint.textContent = `Drop to upload to ${displayPath(location.root, location.folder)}`;
  }

  async function upload(files: File[], location = getDestination()) {
    if (uploading || isBlocked() || !files.length) return;
    const { root, folder: destination } = location;
    uploading = true;
    button.disabled = folderButton.disabled = true;
    results.replaceChildren();
    report(`Destination: ${displayPath(root, destination)}`);
    let successes = 0;
    try {
      for (const [index, file] of files.entries()) {
        button.textContent = `Uploading ${index + 1}/${files.length}…`;
        try {
          if (file.size > maxBytes) throw new Error(`Exceeds ${maxBytes / 1024 / 1024} MiB limit`);
          await uploadFile(root, destination, file);
          successes++;
          report(`${file.name}: uploaded`);
        } catch (error) {
          report(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`, true);
        }
      }
      if (successes) await refresh();
      report(`${successes}/${files.length} uploaded to ${displayPath(root, destination)}`);
    } finally {
      uploading = false;
      button.disabled = folderButton.disabled = false;
      button.textContent = 'Upload files';
      input.value = '';
    }
  }

  async function sendFolder(name: string, getEntries: () => Promise<FolderEntry[]>, location = getDestination()) {
    if (uploading || isBlocked()) return;
    uploading = true;
    button.disabled = folderButton.disabled = true;
    results.replaceChildren();
    report(`Destination: ${displayPath(location.root, location.folder ? `${location.folder}/${name}` : name)}`);
    const status = report('Compressing folder…');
    try {
      const entries = await getEntries();
      const archive = await compressFolder(entries, maxBytes, (done, total) => {
        status.textContent = `Compressing folder… ${done}/${total}`;
      });
      status.textContent = 'Uploading and extracting folder…';
      const result = await uploadFolder(location.root, location.folder, archive);
      await refresh();
      status.textContent = `${result.path}: ${result.files} files uploaded`;
    } catch (error) {
      report(error instanceof Error ? error.message : 'Folder upload failed', true);
    } finally {
      uploading = false;
      button.disabled = folderButton.disabled = false;
      folderInput.value = '';
    }
  }
  folderButton.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', () => {
    const files = Array.from(folderInput.files || []);
    if (files.length) void sendFolder(files[0].webkitRelativePath.split('/')[0], async () => files.map(file => ({ path: file.webkitRelativePath, file })));
  });

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => void upload(Array.from(input.files || [])));
  // Capture file drops before CodeMirror can insert the file into the open document.
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    const blocked = uploading || isBlocked();
    event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
    preview(blocked ? null : dropDestination(event.target));
  }, true);
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) preview(null);
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    preview(null);
    if (uploading || isBlocked()) return;
    const items = Array.from(event.dataTransfer.items);
    const destination = dropDestination(event.target);
    const directories = items.map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry?.isDirectory));
    if (directories.length) {
      if (directories.length !== 1 || items.length !== 1) {
        results.replaceChildren(); report('Drop one folder at a time', true); return;
      }
      void sendFolder(directories[0].name, () => droppedFolder(directories[0]), destination);
    } else {
      void upload(Array.from(event.dataTransfer.files), destination);
    }
  }, true);

  return {
    setLimit(bytes: number) { maxBytes = bytes; },
    isBusy: () => uploading,
  };
}
