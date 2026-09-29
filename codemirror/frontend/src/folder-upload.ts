import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export interface FolderEntry { path: string; file?: File }

/** Drain every readEntries batch; browsers commonly return only 100 at a time. */
export async function droppedFolder(root: FileSystemEntry): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  async function visit(entry: FileSystemEntry, parent = ''): Promise<void> {
    const path = parent + entry.name;
    if (entries.length >= 10000 || path.split('/').length > 32) throw new Error('Folder exceeds 10000 entries or 32 levels');
    if (entry.isDirectory) {
      entries.push({ path: path + '/' });
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, path + '/');
      }
    } else {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      entries.push({ path, file });
    }
  }
  await visit(root);
  return entries;
}

/** Incremental ZIP compression yields between chunks; no worker/blob CSP exemption. */
export async function compressFolder(entries: FolderEntry[], limit: number, progress: (done: number, total: number) => void): Promise<Blob> {
  if (!entries.length || entries.length > 10000) throw new Error('Folder must contain 1–10000 entries');
  const size = entries.reduce((total, entry) => total + (entry.file?.size || 0), 0);
  if (size > limit) throw new Error('Uncompressed folder exceeds the upload limit');
  const chunks: BlobPart[] = [];
  let compressed = 0;
  let failure: Error | null = null;
  let done = 0;
  const zip = new Zip((error, chunk) => {
    if (error) { failure = error; return; }
    compressed += chunk.length;
    if (compressed > limit + 1024 * 1024) { failure = new Error('Compressed folder exceeds the upload limit'); return; }
    chunks.push(new Uint8Array(chunk).buffer);
  });
  for (const entry of entries) {
    if (entry.path.split('/').filter(Boolean).length > 32) throw new Error('Folder exceeds 32 levels');
    if (!entry.file) {
      const directory = new ZipPassThrough(entry.path);
      zip.add(directory); directory.push(new Uint8Array(), true);
    } else {
      const item = new ZipDeflate(entry.path, { level: 6 });
      zip.add(item);
      for (let offset = 0; offset < entry.file.size; offset += 64 * 1024) {
        const data = new Uint8Array(await entry.file.slice(offset, offset + 64 * 1024).arrayBuffer());
        item.push(data, false);
        if (failure) throw failure;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      item.push(new Uint8Array(), true);
    }
    progress(++done, entries.length);
    if (failure) throw failure;
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks, { type: 'application/zip' });
}
