import { uploadFile } from './api';

/** Folder-aware drop/picker upload with per-file errors and no silent overwrite. */
export function initUploads(getDestination: () => { root: string; folder: string }, refresh: () => Promise<void>, isBlocked: () => boolean) {
  const sidebar = document.getElementById('sidebar')!;
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
    button.disabled = true;
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
      button.disabled = false;
      button.textContent = 'Upload files';
      input.value = '';
    }
  }

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
    if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      results.replaceChildren();
      report('Folder uploads are not supported. Select the files inside the folder.', true);
      return;
    }
    const target = (event.target as Element).closest<HTMLElement>('.tree-item.directory');
    const parts = target?.dataset.path?.split('/');
    const destination = parts ? { root: parts[0], folder: parts.slice(1).join('/') } : getDestination();
    void upload(Array.from(event.dataTransfer.files), destination);
  }, true);

  return {
    setLimit(bytes: number) { maxBytes = bytes; },
    isBusy: () => uploading,
  };
}
