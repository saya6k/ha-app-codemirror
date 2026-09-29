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
  let uploading = false;
  let maxBytes = 32 * 1024 * 1024;

  function report(message: string, failed = false) {
    const line = document.createElement('p');
    line.textContent = message;
    if (failed) line.className = 'error';
    results.append(line);
  }

  async function upload(files: File[], location = getDestination()) {
    if (uploading || isBlocked() || !files.length) return;
    const { root, folder: destination } = location;
    uploading = true;
    button.disabled = folderButton.disabled = true;
    results.replaceChildren();
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
      report(`${successes}/${files.length} uploaded to /${root === 'local_apps' ? 'addons' : root}${destination ? '/' + destination : ''}`);
    } finally {
      uploading = false;
      button.disabled = folderButton.disabled = false;
      button.textContent = 'Upload files';
      input.value = '';
    }
  }

  async function sendFolder(getEntries: () => Promise<FolderEntry[]>, location = getDestination()) {
    if (uploading || isBlocked()) return;
    uploading = true;
    button.disabled = folderButton.disabled = true;
    results.replaceChildren();
    report('Compressing folder…');
    try {
      const entries = await getEntries();
      const archive = await compressFolder(entries, maxBytes, (done, total) => {
        results.replaceChildren(); report(`Compressing folder… ${done}/${total}`);
      });
      report('Uploading and extracting folder…');
      const result = await uploadFolder(location.root, location.folder, archive);
      await refresh();
      results.replaceChildren(); report(`${result.path}: ${result.files} files uploaded`);
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
    if (files.length) void sendFolder(async () => files.map(file => ({ path: file.webkitRelativePath, file })));
  });

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => void upload(Array.from(input.files || [])));
  // Capture file drops before CodeMirror can insert the file into the open document.
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = (uploading || isBlocked()) ? 'none' : 'copy';
    sidebar.classList.toggle('drop-active', !uploading && !isBlocked());
  }, true);
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) sidebar.classList.remove('drop-active');
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    sidebar.classList.remove('drop-active');
    if (uploading || isBlocked()) return;
    const items = Array.from(event.dataTransfer.items);
    const target = (event.target as Element).closest<HTMLElement>('.tree-item.directory');
    const parts = target?.dataset.path?.split('/');
    const destination = parts ? { root: parts[0], folder: parts.slice(1).join('/') } : getDestination();
    const directories = items.map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry?.isDirectory));
    if (directories.length) {
      if (directories.length !== 1 || items.length !== 1) {
        results.replaceChildren(); report('Drop one folder at a time', true); return;
      }
      void sendFolder(() => droppedFolder(directories[0]), destination);
    } else {
      void upload(Array.from(event.dataTransfer.files), destination);
    }
  }, true);

  return {
    setLimit(bytes: number) { maxBytes = bytes; },
    isBusy: () => uploading,
  };
}
