/**
 * API Client for backend endpoints
 */

export interface Entity {
  entity_id: string;
  friendly_name: string;
  domain: string;
  state: string;
  state_translated?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  children?: FileInfo[];
  editable?: boolean;
  loading?: boolean;
  error?: string;
  nextOffset?: number | null;
}

export interface FileContent {
  filename: string;
  content: string;
  size: number;
  modified: string;
}

export interface ValidationResult {
  result: 'valid' | 'invalid' | 'unavailable' | 'unknown';
  errors: string | null;
}

export interface EditorSettings {
  indent_style: 'spaces' | 'lines';
  indent_opacity: number;
}

// API base uses relative path for Home Assistant app compatibility
// Works correctly in iOS WebView and all other environments
const API_BASE = './api';

export async function renderTemplate(template: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${API_BASE}/template`, {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-CodeMirror-Request': '1' },
    body: JSON.stringify({ template }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (typeof data.result !== 'string') throw new Error('Invalid template response');
  return data.result;
}

/**
 * Encode file path for URL with proper handling of slashes
 * iOS WebView can be sensitive to how slashes are encoded
 */
const encodeFilePath = (filename: string): string => {
  // Don't encode the forward slashes in paths, but encode everything else
  // This is crucial for iOS WebView compatibility
  return filename.split('/').map(segment => encodeURIComponent(segment)).join('/');
};



/**
 * Fetch all entities from Home Assistant
 */
export async function fetchEntities(): Promise<Entity[]> {
  const url = `${API_BASE}/entities`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'same-origin',
      mode: 'cors'
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch entities: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
    }
    return response.json();
  } catch (error) {
    throw error;
  }
}

/**
 * Fetch editor settings configured in the Home Assistant app options.
 */
export async function fetchSettings(): Promise<EditorSettings> {
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    credentials: 'same-origin',
    mode: 'cors',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch editor settings: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch list of configuration files
 */
export async function fetchFiles(root = 'config', path = '', offset = 0): Promise<{ entries: FileInfo[]; next_offset: number | null }> {
  const query = new URLSearchParams({ root, path, offset: String(offset) });
  const response = await fetch(`${API_BASE}/directory?${query}`, {
    credentials: 'same-origin', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Read a specific file
 */
export async function readFile(filename: string, root: string = 'config'): Promise<FileContent> {
  const encodedFilename = encodeFilePath(filename);
  const url = `${API_BASE}/files/${encodedFilename}?root=${encodeURIComponent(root)}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-CodeMirror-Request': '1',
      },
      credentials: 'same-origin',
      mode: 'cors'
    });
    
    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        // Error reading response body
      }
      
      const errorMessage = `Failed to read file: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`;
      throw new Error(errorMessage);
    }
    
    return response.json();
  } catch (error: any) {
    throw error;
  }
}

/**
 * Save a file
 */
export async function saveFile(filename: string, content: string, root: string = 'config'): Promise<void> {
  const encodedFilename = encodeFilePath(filename);
  const url = `${API_BASE}/files/${encodedFilename}?root=${encodeURIComponent(root)}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CodeMirror-Request': '1',
      },
      credentials: 'same-origin',
      mode: 'cors',
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      let error = {};
      try {
        error = await response.json();
      } catch (e) {
        error = { raw_response: await response.text().catch(() => 'Could not read error response') };
      }
      
      const errorMessage = (error as any).error || `Failed to save file: ${response.statusText}`;
      throw new Error(errorMessage);
    }
  } catch (error: any) {
    throw error;
  }
}

/**
 * Run Home Assistant configuration validation
 */
export async function validateConfig(): Promise<ValidationResult> {
  const url = `${API_BASE}/validate`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-CodeMirror-Request': '1',
      },
      credentials: 'same-origin',
      mode: 'cors',
      body: JSON.stringify({}),
    });

    let result: ValidationResult | null = null;
    try {
      result = await response.json();
    } catch (e) {
      result = null;
    }

    if (!response.ok) {
      return result || {
        result: 'unavailable',
        errors: `Validation failed: ${response.statusText}`,
      };
    }

    return result || {
      result: 'unavailable',
      errors: 'Validation returned no response',
    };
  } catch (error: any) {
    return {
      result: 'unavailable',
      errors: error?.message || 'Could not check Home Assistant config',
    };
  }
}


export interface Workspace {
  id: string;
  label: string;
  available: boolean;
  enabled: boolean;
}

export async function fetchRoots(): Promise<{ roots: Workspace[]; max_upload_bytes: number }> {
  const response = await fetch(`${API_BASE}/roots`);
  if (!response.ok) throw new Error('Could not load workspaces');
  return response.json();
}

export async function setRootEnabled(id: string, enabled: boolean): Promise<Workspace[]> {
  const response = await fetch(`${API_BASE}/roots/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CodeMirror-Request': '1' },
    body: JSON.stringify({ enabled }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not change directory access');
  return data.roots;
}

/** Upload one file per request so a batch can report individual outcomes. */
export async function uploadFile(root: string, directory: string, file: File): Promise<void> {
  const body = new FormData();
  body.append('directory', directory);
  body.append('file', file);
  const response = await fetch(`${API_BASE}/upload?root=${encodeURIComponent(root)}`, {
    method: 'POST',
    headers: { 'X-CodeMirror-Request': '1' },
    body,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Upload failed (${response.status})`);
  }
}

/** Create without overwriting; file contents and directory checks live on the server. */
export async function createEntry(root: string, directory: string, name: string, type: 'file' | 'directory'):
  Promise<{ path: string; type: 'file' | 'directory' }> {
  const response = await fetch(`${API_BASE}/entries?root=${encodeURIComponent(root)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CodeMirror-Request': '1' },
    body: JSON.stringify({ directory, name, type }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not create entry');
  return data;
}

export type HAAction = 'restart' | 'reload' | 'reload-automations' | 'reload-scripts' | 'reload-groups' | 'reload-core';

export async function runHAAction(action: HAAction): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/ha/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CodeMirror-Request': '1' },
    body: '{}',
  });
  const data = await response.json();
  if (!response.ok) throw new Error([data.error || 'Home Assistant action failed', data.details].filter(Boolean).join('\n'));
  return data;
}

export async function entryAction(root: string, path: string, action: 'move' | 'copy' | 'delete', destinationRoot?: string, destination?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/entries/action?root=${encodeURIComponent(root)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CodeMirror-Request': '1' },
    body: JSON.stringify({ path, action, destination_root: destinationRoot ?? root, destination }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'File operation failed');
}

export async function uploadFolder(root: string, directory: string, archive: Blob): Promise<{ path: string; files: number }> {
  const body = new FormData();
  body.append('directory', directory);
  body.append('file', archive, 'folder.zip');
  const response = await fetch(`${API_BASE}/upload-folder?root=${encodeURIComponent(root)}`, {
    method: 'POST', headers: { 'X-CodeMirror-Request': '1' }, body,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Folder upload failed');
  return result;
}
