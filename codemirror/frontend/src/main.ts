/**
 * Main application entry point
 */

import { initTheme } from './theme';
import { createEditor, setEditorReadOnly, setContent, getContent, registerSaveShortcut, editorUndo, editorRedo, editorIndent, editorDedent, canEditorUndo, canEditorRedo, restoreLastValidContent, applyAppearanceSettings, scrollEditorSelectionIntoView, configureEditorForFile, getEditorFileType, validateCurrentDocument, captureEditor, restoreEditor } from './editor';
import { fetchRoots, setRootEnabled, fetchEntities, fetchFiles, fetchSettings, readFile, saveFile, validateConfig, type EditorSettings, type FileInfo, type Workspace } from './api';
import { setEntities } from './autocomplete';
import { getAppearanceSettings, initAppearance } from './appearance';
import { formatDocument } from './formatter';
import { initMarkdownPreview } from './markdown';
import { initTemplatePreview } from './template-preview';
import { initUploads } from './uploads';
import { initToolbar } from './toolbar';
import { initExplorerActions } from './explorer-actions';
import { text, initLanguage } from './i18n';
import { createTabs, tabKey } from './tabs';

// Application state
initLanguage();
let currentFile: string | null = null;
let resetTemplatePreview = () => {};
let currentRoot = 'config';
let roots: Workspace[] = [];
let selectedPath = 'config';
function splitPath(path: string) { const [root, ...rest] = path.split('/'); return { root, path: rest.join('/') }; }
function selectedFolder() {
  const node = findNodeByPath(files, selectedPath);
  const path = (node?.type === 'file' || (currentFile !== null && selectedPath === currentRoot + '/' + currentFile)) ? selectedPath.slice(0, selectedPath.lastIndexOf('/')) : selectedPath;
  const location = splitPath(path);
  return { root: location.root, folder: location.path };
}
let isSaving = false;
let isToolbarBusy = false;
let entitiesLoading = false;
let isModified = false;
let isLoadingFile = false;
let isDocumentValid = true;
let files: FileInfo[] = [];
let treeLoadVersion = 0;
let expandedDirs: Set<string> = new Set();
let validationDetails: string | null = null;
let validationDetailsTitle = 'Home Assistant validation';
let isValidationDetailsOpen = false;

// Event listener references for cleanup
let fileListClickHandler: ((e: Event) => void) | null = null;
let editorChangeHandler: ((e: Event) => void) | null = null;
let saveButtonHandler: (() => void) | null = null;
let mobileMenuHandler: (() => void) | null = null;
let sidebarOverlayHandler: (() => void) | null = null;
let undoButtonHandler: (() => void) | null = null;
let redoButtonHandler: (() => void) | null = null;
let indentButtonHandler: (() => void) | null = null;
let dedentButtonHandler: (() => void) | null = null;
let statusBarHandler: (() => void) | null = null;
let validationCloseHandler: (() => void) | null = null;

// LocalStorage keys
const STORAGE_KEY_CURRENT_FILE = 'codemirror:current-file';
const STORAGE_KEY_ROOT = 'codemirror:root';
const STORAGE_KEY_EXPANDED_DIRS = 'codemirror:expanded-dirs';

function isYamlFile(filename: string): boolean {
  return getEditorFileType(filename) === 'yaml';
}

function isStructuredFile(filename: string): boolean {
  const fileType = getEditorFileType(filename);
  return fileType === 'yaml' || fileType === 'json';
}

// DOM elements
const fileListEl = document.getElementById('file-list')!;
const currentFilenameEl = document.getElementById('current-filename')!;
const saveBtnEl = document.getElementById('save-btn') as HTMLElement;
const saveBtnMobileEl = document.getElementById('save-btn-mobile') as HTMLElement;
const statusMessageEl = document.getElementById('status-message')!;
const statusInfoEl = document.getElementById('status-info')!;
const statusBarEl = document.getElementById('status-bar')!;
const validationDetailsEl = document.getElementById('validation-details') as HTMLElement;
const validationDetailsTitleEl = document.getElementById('validation-details-title')!;
const validationDetailsContentEl = document.getElementById('validation-details-content')!;
const validationDetailsRestoreEl = document.getElementById('validation-details-restore') as HTMLButtonElement;
const validationDetailsCloseEl = document.getElementById('validation-details-close') as HTMLElement;
const editorEl = document.getElementById('editor')!;
const mobileMenuToggleEl = document.getElementById('mobile-menu-toggle') as HTMLElement;
const sidebarEl = document.getElementById('sidebar')!;
const sidebarOverlayEl = document.getElementById('sidebar-overlay')!;
const mobileFilenameEl = document.getElementById('mobile-filename')!;

// Mobile toolbar elements
const undoBtnEl = document.getElementById('undo-btn') as HTMLElement;
const redoBtnEl = document.getElementById('redo-btn') as HTMLElement;
const indentBtnEl = document.getElementById('indent-btn') as HTMLElement;
const dedentBtnEl = document.getElementById('dedent-btn') as HTMLElement;
const editorToolbarEl = document.getElementById('editor-toolbar') as HTMLElement;
const updatePreview = initMarkdownPreview(getContent);
const documents = createTabs(loadFile, closeTab);
const uploads = initUploads(selectedFolder, loadFiles, () => isToolbarBusy || isLoadingFile || isSaving);
function updateEmptyDocumentLabels(): void {
  if (currentFile) return;
  currentFilenameEl.textContent = text('No file selected', '선택한 파일 없음');
  mobileFilenameEl.textContent = text('No file', '파일 없음');
}
window.addEventListener('language-changed', updateEmptyDocumentLabels);
updateEmptyDocumentLabels();


async function initializeWorkspaces(): Promise<void> {
  const result = await fetchRoots();
  roots = result.roots;
  uploads.setLimit(result.max_upload_bytes);
  const savedRoot = localStorage.getItem(STORAGE_KEY_ROOT) ?? 'config';
  if (roots.some(root => root.id === savedRoot && root.available && root.enabled)) currentRoot = savedRoot;
  else {
    // The saved file belongs to a root that is now off; never reopen it from another root.
    localStorage.removeItem(STORAGE_KEY_CURRENT_FILE);
    currentRoot = firstEnabledRoot();
  }
  selectedPath = currentRoot;
  expandedDirs.add(currentRoot);
  renderRootOptions();
}

function firstEnabledRoot(): string {
  return roots.find(root => root.enabled)?.id ?? '';
}

const rootOptionsEl = document.getElementById('root-options')!;
function renderRootOptions(): void {
  rootOptionsEl.replaceChildren(...roots.map(root => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.value = root.id; box.checked = root.enabled;
    label.append(box, ' ' + root.label);
    if (!root.available) label.title = text('Directory is not mounted', '디렉토리가 마운트되지 않았습니다');
    return label;
  }));
}

// Turning a directory off closes its open tabs, so refuse while any of them has unsaved edits.
rootOptionsEl.addEventListener('change', async (event) => {
  const box = event.target as HTMLInputElement;
  const root = box.value;
  const label = roots.find(item => item.id === root)?.label ?? root;
  syncActiveTab();
  const tabs = Array.from(documents.tabs.entries()).filter(([, tab]) => tab.root === root);
  if (isLoadingFile || isSaving || isToolbarBusy || (!box.checked && tabs.some(([, tab]) => tab.modified))) {
    box.checked = !box.checked;
    updateStatus(text(`Save or close unsaved files in ${label} first`, `${label}의 저장하지 않은 파일을 먼저 저장하거나 닫으세요`), '', true);
    return;
  }
  box.disabled = true;
  try {
    roots = await setRootEnabled(root, box.checked);
  } catch (error) {
    box.checked = !box.checked;
    updateStatus(error instanceof Error ? error.message : String(error), '', true);
    return;
  } finally {
    box.disabled = false;
  }
  if (box.checked) {
    expandedDirs.add(root);
    if (!currentRoot) selectedPath = currentRoot = root;
  } else {
    for (const [key] of tabs) documents.tabs.delete(key);
    if (currentRoot === root) {
      const hadFile = currentFile !== null;
      if (hadFile) clearOpenDocument();
      currentRoot = firstEnabledRoot();
      const next = Array.from(documents.tabs.values()).pop();
      if (hadFile && next) await loadFile(next.path, next.root);
    }
    documents.activate(currentFile ? tabKey(currentRoot, currentFile) : '');
    if (splitPath(selectedPath).root === root) selectedPath = currentRoot;
  }
  saveState();
  renderRootOptions();
  await loadFiles();
});

window.addEventListener('beforeunload', (event) => {
  if (isModified || Array.from(documents.tabs.values()).some(tab => tab.modified) || uploads.isBusy()) { event.preventDefault(); event.returnValue = ''; }
});
// Upstream toolbar uses role=button elements; retain mobile behavior and add keyboard support.
document.querySelectorAll<HTMLElement>('[role="button"]').forEach((button) => {
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
  });
});
fileListEl.addEventListener('keydown', (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>('.tree-item');
  if (!item?.dataset.path) return;
  const path = item.dataset.path;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault(); item.click();
  } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    let next: HTMLElement | null = item;
    if (event.key === 'ArrowUp') next = item.previousElementSibling as HTMLElement;
    if (event.key === 'ArrowDown') next = item.nextElementSibling as HTMLElement;
    if (event.key === 'ArrowRight') {
      if (item.classList.contains('directory') && !expandedDirs.has(path)) toggleDirectory(path);
      else next = item.nextElementSibling as HTMLElement;
    }
    if (event.key === 'ArrowLeft') {
      if (expandedDirs.has(path)) toggleDirectory(path);
      else next = fileListEl.querySelector(`[data-path="${CSS.escape(path.slice(0, path.lastIndexOf('/')))}"]`);
    }
    const target = next?.isConnected ? next : fileListEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
    if (target?.dataset.path) { selectedPath = target.dataset.path; highlightSelection(); target.focus(); }
  }
});
document.getElementById('refresh-files')!.addEventListener('click', () => void loadFiles());



/**
 * Update mobile toolbar button states based on undo/redo availability
 */
function updateToolbarButtonStates(): void {
  const canUndo = canEditorUndo();
  const canRedo = canEditorRedo();

  if (undoBtnEl) {
    undoBtnEl.setAttribute('aria-disabled', canUndo ? 'false' : 'true');
  }
  
  if (redoBtnEl) {
    redoBtnEl.setAttribute('aria-disabled', canRedo ? 'false' : 'true');
  }
}

/**
 * Handle undo button click
 */
function handleUndo(): void {
  // Only perform undo if it's available
  if (canEditorUndo()) {
    editorUndo();
    updateToolbarButtonStates();
  }
}

/**
 * Handle redo button click
 */
function handleRedo(): void {
  // Only perform redo if it's available
  if (canEditorRedo()) {
    editorRedo();
    updateToolbarButtonStates();
  }
}

/**
 * Handle indent button click
 */
function handleIndent(): void {
  editorIndent();
}

/**
 * Handle dedent button click
 */
function handleDedent(): void {
  editorDedent();
}

/**
 * Clear expanded validation details when content context changes
 */
function clearValidationDetails(): void {
  validationDetails = null;
  isValidationDetailsOpen = false;
  validationDetailsEl.hidden = true;
  statusBarEl.classList.remove('has-details');
  statusBarEl.removeAttribute('title');
}

/**
 * Store validation details and update collapsed/expanded display
 */
function setValidationDetails(title: string, details: string, showRestore: boolean = true): void {
  validationDetailsTitle = title;
  validationDetails = details;
  isValidationDetailsOpen = false;
  validationDetailsEl.hidden = true;
  statusBarEl.classList.add('has-details');
  statusBarEl.setAttribute('title', details);
  validationDetailsTitleEl.textContent = title;
  validationDetailsContentEl.textContent = details;
  validationDetailsRestoreEl.style.display = showRestore ? 'inline-block' : 'none';
}

/**
 * Toggle Home Assistant validation details panel
 */
function toggleValidationDetails(): void {
  if (!validationDetails) {
    return;
  }

  isValidationDetailsOpen = !isValidationDetailsOpen;
  validationDetailsTitleEl.textContent = validationDetailsTitle;
  validationDetailsContentEl.textContent = validationDetails;
  validationDetailsEl.hidden = !isValidationDetailsOpen;
}

function closeValidationDetails(): void {
  isValidationDetailsOpen = false;
  validationDetailsEl.hidden = true;
}

/**
 * Save state to localStorage
 */
function saveState(): void {
  localStorage.setItem(STORAGE_KEY_ROOT, currentRoot);
  if (currentFile) {
    localStorage.setItem(STORAGE_KEY_CURRENT_FILE, currentFile);
  }
  localStorage.setItem(STORAGE_KEY_EXPANDED_DIRS, JSON.stringify(Array.from(expandedDirs)));
}

/**
 * Restore state from localStorage
 */
function restoreState(): void {
  // Restore expanded directories
  const savedExpandedDirs = localStorage.getItem(STORAGE_KEY_EXPANDED_DIRS);
  if (savedExpandedDirs) {
    try {
      const dirs = JSON.parse(savedExpandedDirs);
      expandedDirs = new Set(dirs);
    } catch (e) {
      console.error('Failed to restore expanded directories:', e);
    }
  }
}

/**
 * Keep the mobile toolbar above the visible viewport while the editor is focused.
 */
function setupEditingToolbar(onPositionChange?: () => void): void {
  const toolbar = document.querySelector('.editor-toolbar') as HTMLElement;
  const editor = document.querySelector('.cm-editor') as HTMLElement;
  if (!toolbar || !editor) return;

  let editorFocused = false;
  let updateFrame: number | null = null;
  let selectionScrollScheduled = false;
  let keyboardInset: number | null = null;

  const getViewport = (): VisualViewport | null => {
    if (window.parent !== window) {
      try {
        return window.parent.visualViewport || null;
      } catch {
        // Parent access is unavailable outside same-origin ingress.
      }
    }
    return window.visualViewport || null;
  };

  const resetToolbarPosition = () => {
    toolbar.classList.remove('keyboard-docked');
    toolbar.style.removeProperty('--keyboard-inset');
  };

  const updateToolbarPosition = () => {
    updateFrame = null;
    const viewport = getViewport();
    if (!viewport) return;

    if (!editorFocused) {
      keyboardInset = null;
      resetToolbarPosition();
      return;
    }

    let overlap = 0;
    if (window.parent !== window) {
      try {
        const frame = window.frameElement;
        if (frame) {
          const frameRect = frame.getBoundingClientRect();
          const visibleBottom = viewport.offsetTop + viewport.height;
          overlap = frameRect.bottom - visibleBottom;
        }
      } catch {
        // Fall back to the local viewport when the frame is inaccessible.
      }
    } else {
      overlap = window.innerHeight - viewport.height - viewport.offsetTop;
    }

    if (overlap <= 80) {
      if (keyboardInset !== null) {
        keyboardInset = null;
        resetToolbarPosition();
        onPositionChange?.();
      }
      return;
    }

    const nextInset = Math.min(600, Math.max(0, overlap));
    if (keyboardInset !== null && Math.abs(keyboardInset - nextInset) < 1) return;

    keyboardInset = nextInset;
    toolbar.classList.add('keyboard-docked');
    toolbar.style.setProperty('--keyboard-inset', `${keyboardInset}px`);

    if (!selectionScrollScheduled) {
      selectionScrollScheduled = true;
      window.setTimeout(() => {
        selectionScrollScheduled = false;
        if (editorFocused) onPositionChange?.();
      }, 200);
    }
  };

  const scheduleUpdate = () => {
    if (updateFrame === null) updateFrame = requestAnimationFrame(updateToolbarPosition);
  };

  const viewport = getViewport();
  viewport?.addEventListener('resize', scheduleUpdate);
  viewport?.addEventListener('scroll', scheduleUpdate);
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('orientationchange', scheduleUpdate);

  editor.addEventListener('focusin', () => {
    editorFocused = true;
    keyboardInset = null;
    selectionScrollScheduled = false;
    scheduleUpdate();
  });
  editor.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!editor.contains(document.activeElement)) {
        editorFocused = false;
        resetToolbarPosition();
        keyboardInset = null;
        onPositionChange?.();
      }
    }, 100);
  });
}

/**
 * Initialize the application
 */
async function init(): Promise<void> {
   try {
     // Initialize theme
     initTheme();

      let editorSettings: EditorSettings = {
        indent_style: 'spaces',
        indent_opacity: 100,
      };
      try {
        editorSettings = await fetchSettings();
      } catch (error) {
        console.warn('Using default editor settings:', error);
      }
      initAppearance(editorSettings);

      // Create editor
      const view = createEditor(editorEl, editorSettings);
      resetTemplatePreview = initTemplatePreview(view, () => !!currentFile && !isLoadingFile);
      initToolbar({
        context: () => ({ ...selectedFolder(), file: currentFile, modified: hasUnsavedTabs() }),
        isBusy: () => isSaving || isLoadingFile || isToolbarBusy || uploads.isBusy(),
        setBusy: (busy) => { isToolbarBusy = busy; setEditorReadOnly(busy || !currentFile); },
        refreshFiles: loadFiles,
        refreshEntities: loadEntities,
        openFile: loadFile,
        selectFolder: (folder, root) => {
          selectedPath = root + (folder ? '/' + folder : '');
          expandParentDirectories(selectedPath + '/');
          renderFileList();
          const node = findNodeByPath(files, selectedPath);
          if (node && !node.children) void loadDirectory(node);
        },
        status: updateStatus,
        details: (title, message) => setValidationDetails(title, message, false),
        clearDetails: clearValidationDetails,
      });
      initExplorerActions({
        selection: () => ({ ...splitPath(selectedPath), type: findNodeByPath(files, selectedPath)?.type || 'directory' }),
        select: (path) => { selectedPath = path; highlightSelection(); },
        folder: selectedFolder,
        busy: () => isSaving || isLoadingFile || isToolbarBusy || uploads.isBusy(),
        setBusy: (busy) => { isToolbarBusy = busy; setEditorReadOnly(busy || !currentFile); },
        canChange: (source) => {
          syncActiveTab();
          if (Array.from(documents.tabs.entries()).some(([key, tab]) => tab.modified && (key === source || key.startsWith(source + '/')))) {
            updateStatus(text('Save changes before modifying this entry', '이 항목을 변경하기 전에 저장하세요'), '', true);
            return false;
          }
          return true;
        },
        changed: async (source, target) => {
          syncActiveTab();
          const opened = currentFile ? tabKey(currentRoot, currentFile) : '';
          let nextActive: string | null = null;
          for (const [key, tab] of Array.from(documents.tabs.entries())) {
            if (key !== source && !key.startsWith(source + '/')) continue;
            documents.tabs.delete(key);
            if (target) {
              const next = target + key.slice(source.length);
              const location = splitPath(next);
              documents.tabs.set(next, { ...tab, root: location.root, path: location.path });
              if (key === opened) nextActive = next;
            }
          }
          if (opened === source || opened.startsWith(source + '/')) {
            clearOpenDocument();
            const next = nextActive || Array.from(documents.tabs.keys()).pop();
            if (next) { const location = splitPath(next); await loadFile(location.path, location.root); }
          }
          documents.activate(currentFile ? tabKey(currentRoot, currentFile) : '');
        },
        refresh: loadFiles,
        status: message => updateStatus(message, ''),
        error: message => updateStatus(message, '', true),
      });
      applyAppearanceSettings(getAppearanceSettings());
      window.addEventListener('appearance-changed', (event) => {
        const settings = (event as CustomEvent<ReturnType<typeof getAppearanceSettings>>).detail;
        applyAppearanceSettings(settings);
      });

     // Register save shortcut
     registerSaveShortcut(handleSave);

      // Listen for editor changes (store handler for potential cleanup)
      editorChangeHandler = () => {
        // Ignore changes while loading a file
        if (isLoadingFile || !currentFile) {
          return;
        }

         isModified = true;
         const activeTab = currentFile && documents.tabs.get(tabKey(currentRoot, currentFile));
         if (activeTab) activeTab.modified = true;
         documents.render();
         // We don't clear validation details here anymore to prevent flickering.
         // editor-validation event will handle clearing if the document becomes valid.
         if (isDocumentValid) {
           if (saveBtnEl) saveBtnEl.setAttribute('aria-disabled', 'false');
           if (saveBtnMobileEl) saveBtnMobileEl.setAttribute('aria-disabled', 'false');
           updateStatus('Modified', '');
         }
        
        // Update toolbar button states after content changes
        updateToolbarButtonStates();
      };
      window.addEventListener('editor-changed', editorChangeHandler);

      window.addEventListener('editor-validation', (e: Event) => {
        if (isLoadingFile) return;
        
        const customEvent = e as CustomEvent<any>;
        const validation = customEvent.detail;
        isDocumentValid = validation.isValid;
        
        if (!isDocumentValid) {
          if (saveBtnEl) saveBtnEl.setAttribute('aria-disabled', 'true');
          if (saveBtnMobileEl) saveBtnMobileEl.setAttribute('aria-disabled', 'true');
          
          setValidationDetails('Invalid Configuration', validation.errors.join('\n'));
          updateStatus('Invalid config', 'Cannot save', true);
          
           // Keep transient mobile editing errors collapsed so they do not cover the editor.
           const editorFocused = document.querySelector('.cm-editor')?.contains(document.activeElement) ?? false;
           const keepCollapsed = editorFocused && window.matchMedia('(pointer: coarse)').matches;
           if (!keepCollapsed && !isValidationDetailsOpen) {
             toggleValidationDetails();
           }
        } else {
          // If valid now, check for warnings
          if (validation.warnings && validation.warnings.length > 0) {
            setValidationDetails('Configuration Warnings', validation.warnings.join('\n'), false);
            if (isModified) {
              if (saveBtnEl) saveBtnEl.setAttribute('aria-disabled', 'false');
              if (saveBtnMobileEl) saveBtnMobileEl.setAttribute('aria-disabled', 'false');
              updateStatus('Modified (Warnings)', 'Click for details', false, false, true);
            }
          } else {
            // No errors and no warnings
            if (validationDetails) {
              clearValidationDetails();
            }
            if (isModified) {
              if (saveBtnEl) saveBtnEl.setAttribute('aria-disabled', 'false');
              if (saveBtnMobileEl) saveBtnMobileEl.setAttribute('aria-disabled', 'false');
              updateStatus('Modified', '');
            }
          }
        }
      });

      // Set up button listeners (store handlers for cleanup)
      saveButtonHandler = handleSave;
      mobileMenuHandler = toggleMobileSidebar;
      sidebarOverlayHandler = closeMobileSidebar;
      undoButtonHandler = handleUndo;
      redoButtonHandler = handleRedo;
      indentButtonHandler = handleIndent;
       dedentButtonHandler = handleDedent;
        statusBarHandler = toggleValidationDetails;
        validationCloseHandler = closeValidationDetails;

      if (validationDetailsRestoreEl) {
        validationDetailsRestoreEl.addEventListener('click', () => {
          if (restoreLastValidContent()) {
             closeValidationDetails();
             updateStatus('Restored to valid state', '');
          }
        });
      }

      if (saveBtnEl) saveBtnEl.addEventListener('click', saveButtonHandler);
      if (saveBtnMobileEl) saveBtnMobileEl.addEventListener('click', saveButtonHandler);

      // Mobile menu toggle
      mobileMenuToggleEl.addEventListener('click', mobileMenuHandler);
      sidebarOverlayEl.addEventListener('click', sidebarOverlayHandler);

// Mobile toolbar buttons
        if (undoBtnEl) {
          undoBtnEl.addEventListener('click', undoButtonHandler);
        }
        if (redoBtnEl) {
          redoBtnEl.addEventListener('click', redoButtonHandler);
        }
        if (indentBtnEl) {
          indentBtnEl.addEventListener('click', indentButtonHandler);
        }
        if (dedentBtnEl) {
          dedentBtnEl.addEventListener('click', dedentButtonHandler);
        }
        statusBarEl.addEventListener('click', statusBarHandler);
        validationDetailsCloseEl.addEventListener('click', validationCloseHandler);
         editorToolbarEl.addEventListener('pointerdown', (event) => {
           const target = (event.target as HTMLElement).closest(
             '#undo-btn, #redo-btn, #indent-btn, #dedent-btn, #save-btn-mobile',
           ) as HTMLElement | null;
           if (!target) return;

           // Keep CodeMirror focused so iOS does not dismiss the keyboard.
           event.preventDefault();
         });
      
      // Initialize toolbar button states
      updateToolbarButtonStates();

       // Keep the editing toolbar above the keyboard
       setupEditingToolbar(scrollEditorSelectionIntoView);

    // Restore state
    await initializeWorkspaces();
    restoreState();
    expandedDirs.add(currentRoot);

    // HA entity translation and unrelated mounts must not delay opening a file.
    void loadEntities();
    const savedFile = localStorage.getItem(STORAGE_KEY_CURRENT_FILE);
    if (savedFile) expandParentDirectories(currentRoot + '/' + savedFile);
    void loadFiles();
    if (savedFile) await loadFile(savedFile);

    updateStatus('Ready', '');
  } catch (error) {
    console.error('Initialization error:', error);
    updateStatus('Initialization failed', '', true);
  }
}

/**
 * Expand all parent directories for a given file path
 */
function expandParentDirectories(filePath: string): void {
  // Split path into parts and expand each parent directory
  const parts = filePath.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    const dirPath = parts.slice(0, i + 1).join('/');
    expandedDirs.add(dirPath);
  }
  saveState();
}

/**
 * Load file list
 */
async function loadFiles(): Promise<void> {
  ++treeLoadVersion;
  files = roots.filter(root => root.enabled).map(root => ({ name: root.label, path: root.id, type: 'directory',
    error: root.available ? undefined : text('Directory is not mounted', '디렉토리가 마운트되지 않았습니다') }));
  renderFileList();
  await Promise.all(files.filter(node => expandedDirs.has(node.path) && !node.error).map(node => loadDirectory(node)));
}

async function loadDirectory(node: FileInfo, more = false): Promise<void> {
  if (node.loading) return;
  const version = treeLoadVersion;
  const location = splitPath(node.path);
  node.loading = true;
  node.error = undefined;
  renderFileList();
  try {
    const page = await fetchFiles(location.root, location.path, more ? node.nextOffset ?? 0 : 0);
    if (version !== treeLoadVersion) return;
    const children = page.entries.map(entry => ({ ...entry, path: location.root + '/' + entry.path }));
    node.children = more ? [...(node.children ?? []), ...children] : children;
    node.children.sort((a, b) => Number(a.type !== 'directory') - Number(b.type !== 'directory') || a.name.localeCompare(b.name));
    node.nextOffset = page.next_offset;
  } catch (reason) {
    if (version !== treeLoadVersion) return;
    node.error = reason instanceof Error ? reason.message : String(reason);
  } finally {
    node.loading = false;
    if (version === treeLoadVersion) renderFileList();
  }
  if (version !== treeLoadVersion || node.error) return;
  await Promise.all((node.children ?? []).filter(child => child.type === 'directory' &&
    expandedDirs.has(child.path) && !child.children).map(child => loadDirectory(child)));
}

/**
 * Load entities
 */
async function loadEntities(): Promise<void> {
  if (entitiesLoading) return;
  entitiesLoading = true;
  const status = document.getElementById('entity-status')!;
  const button = document.getElementById('refresh-entities-btn') as HTMLButtonElement;
  button.disabled = true;
  status.textContent = 'Loading entities…';
  try {
    const entities = await fetchEntities();
    setEntities(entities);
    status.textContent = `${entities.length} entities`;
    status.title = entities.length ? 'Home Assistant connected' : 'Home Assistant connected; no entities returned';
  } catch (reason) {
    setEntities([]);
    status.textContent = 'Entities unavailable';
    status.title = reason instanceof Error ? reason.message : 'Could not connect to Home Assistant';
  } finally {
    entitiesLoading = false;
    button.disabled = false;
  }
}

/**
 * Render a file tree node as HTML (recursively for directories)
 * @param node The FileInfo node to render
 * @param level The nesting level for indentation (0 = root)
 * @returns HTML string for the node and its children
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function renderTreeNode(node: FileInfo, level: number = 0): string {
  const indent = 8 + (level * 16); // VS Code style: 8px base + 16px per level

  if (node.type === 'directory') {
    const isExpanded = expandedDirs.has(node.path);
    const chevronIcon = '<svg class="chevron-icon' + (isExpanded ? ' expanded' : '') + '" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>';

    const folderIcon = isExpanded
      ? '<svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M.54 3.87.5 3h2.672a.5.5 0 0 1 .4.2l.77 1.026h9.159a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H1.5a1 1 0 0 1-1-1V4.887a1 1 0 0 1 .04-.277z"/></svg>'
      : '<svg class="folder-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M.54 3.87.5 3h2.672a.5.5 0 0 1 .4.2l.77 1.026H14.5a.5.5 0 0 1 .5.5v9.5a.5.5 0 0 1-.5.5H1.5a.5.5 0 0 1-.5-.5V4.22a.5.5 0 0 1 .04-.277z"/></svg>';

     let html = `
       <div class="tree-item directory" data-path="${escapeHtml(node.path)}" data-level="${level}" style="padding-left: ${indent}px" role="treeitem" tabindex="0" aria-expanded="${isExpanded}">
         ${chevronIcon}
         ${folderIcon}
         <span class="item-name">${escapeHtml(node.name)}</span>
       </div>
     `;

     if (isExpanded && node.children && node.children.length > 0) {
       for (const child of node.children) {
         html += renderTreeNode(child, level + 1);
       }
     }

     if (isExpanded) {
       const padding = `padding-left: ${indent + 24}px`;
       if (node.loading) html += `<div class="directory-status" style="${padding}" role="status">${text('Loading…', '불러오는 중…')}</div>`;
       else if (node.error) html += `<div class="directory-status directory-error" style="${padding}" role="alert">${escapeHtml(node.error)} <button data-directory-action="retry" data-directory="${escapeHtml(node.path)}">${text('Retry', '다시 시도')}</button></div>`;
       else if (node.nextOffset != null) html += `<button class="directory-status" style="${padding}" data-directory-action="more" data-directory="${escapeHtml(node.path)}">${text('Load more', '더 보기')}</button>`;
     }
     return html;
   } else {
     // File node - no chevron, so add spacing
     const fileIndent = indent + 20; // Extra space where chevron would be
     return `
       <div class="tree-item file" data-path="${escapeHtml(node.path)}" data-level="${level}" style="padding-left: ${fileIndent}px" role="treeitem" tabindex="0">
         <svg class="file-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
           <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0H4z"/>
           <path d="M9 1v3a1 1 0 0 0 1 1h3L9 1z"/>
         </svg>
         <span class="item-name">${escapeHtml(node.name)}</span>
       </div>
     `;
   }
}

/**
 * Render file list
 */
function renderFileList(): void {
    if (files.length === 0) {
      fileListEl.innerHTML = `<div class="loading">${text('Turn on a directory under Directories.', '디렉토리에서 볼 경로를 켜세요.')}</div>`;
     return;
   }

   let html = '';
   for (const node of files) {
     html += renderTreeNode(node, 0);
   }
   fileListEl.innerHTML = html;

   // Add click handlers for directories using event delegation
   attachFileListListeners();
   highlightSelection();
}

/**
 * Attach event listeners to file list using event delegation
 * This prevents memory leaks from re-attaching listeners on every render
 */
function attachFileListListeners(): void {
   // Remove old handler if it exists
   if (fileListClickHandler) {
     fileListEl.removeEventListener('click', fileListClickHandler);
   }

   // Use event delegation on the parent container
   fileListClickHandler = handleFileListClick;
   fileListEl.addEventListener('click', fileListClickHandler);
}

/**
 * Handle clicks on file list items using event delegation
 * Routes clicks to appropriate handlers (directory toggle or file load)
 * @param e Click event
 */
function handleFileListClick(e: Event): void {
   const target = e.target as HTMLElement;
   const action = target.closest<HTMLElement>('[data-directory-action]');
   if (action) {
     const node = findNodeByPath(files, action.dataset.directory!);
     if (node) void loadDirectory(node, action.dataset.directoryAction === 'more');
     return;
   }
   const treeItem = target.closest('.tree-item') as HTMLElement;

   if (!treeItem) {
     return;
   }

   const path = treeItem.getAttribute('data-path');
   if (!path) {
     return;
   }

   if (treeItem.classList.contains('directory')) {
     e.stopPropagation();
     selectedPath = path;
     toggleDirectory(path);
   } else if (treeItem.classList.contains('file')) {
     if (findNodeByPath(files, path)?.editable === false) {
       updateStatus('This file is stored but cannot be edited as text', '');
       return;
     }
     selectedPath = path;
     highlightSelection();
     const location = splitPath(path);
     void loadFile(location.path, location.root);
     // Close mobile sidebar when file is selected
     closeMobileSidebar();
   }
}

/**
 * Toggle directory expanded/collapsed state
 */
function highlightSelection(): void {
  fileListEl.querySelectorAll<HTMLElement>('.tree-item').forEach(el => {
    const selected = el.dataset.path === selectedPath;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-selected', String(selected));
  });
}
function toggleDirectory(path: string): void {
  if (expandedDirs.has(path)) expandedDirs.delete(path); else expandedDirs.add(path);
  saveState(); renderFileList();
  const node = findNodeByPath(files, path);
  if (node && expandedDirs.has(path) && (!node.children || node.error)) void loadDirectory(node);
}

/**
 * Find a node by path in the file tree
 */
function findNodeByPath(nodes: FileInfo[], targetPath: string): FileInfo | null {
   for (const node of nodes) {
     if (node.path === targetPath) {
       return node;
     }
     if (node.children) {
       const found = findNodeByPath(node.children, targetPath);
       if (found) return found;
     }
   }
   return null;
}

function syncActiveTab(): void {
  if (!currentFile) return;
  documents.tabs.set(tabKey(currentRoot, currentFile), { root: currentRoot, path: currentFile, modified: isModified, snapshot: captureEditor() });
}
function hasUnsavedTabs(): boolean {
  return isModified || Array.from(documents.tabs.values()).some(tab => tab.modified);
}
function clearOpenDocument(): void {
  resetTemplatePreview();
  (document.getElementById('template-btn') as HTMLButtonElement).disabled = true;
  currentFile = null; isModified = false;
  setContent('', true); setEditorReadOnly(true); updatePreview(null); clearValidationDetails();
  currentFilenameEl.textContent = text('No file selected', '선택한 파일 없음');
  mobileFilenameEl.textContent = text('No file', '파일 없음');
  document.getElementById('document-hint')!.textContent = 'Choose a file to start editing';
  localStorage.removeItem(STORAGE_KEY_CURRENT_FILE);
  saveBtnEl.setAttribute('aria-disabled', 'true'); saveBtnMobileEl.setAttribute('aria-disabled', 'true');
}
async function closeTab(key: string): Promise<void> {
  if (isLoadingFile || isSaving || isToolbarBusy) return;
  syncActiveTab();
  const tab = documents.tabs.get(key);
  if (!tab) return;
  if (tab.modified && !window.confirm(text(`Discard unsaved changes and close ${tab.path}?`, `${tab.path}의 저장하지 않은 변경 내용을 버리고 닫을까요?`))) return;
  documents.tabs.delete(key);
  if (currentFile && tabKey(currentRoot, currentFile) === key) {
    clearOpenDocument();
    const next = Array.from(documents.tabs.values()).pop();
    if (next) await loadFile(next.path, next.root);
  }
  documents.activate(currentFile ? tabKey(currentRoot, currentFile) : '');
}

/**
 * Load a file into the editor
 * Fetches file content, updates UI, and marks as active
 * @param filename Path to the file to load
 */
async function loadFile(filename: string, root: string = currentRoot): Promise<void> {
  if (isLoadingFile || isSaving || isToolbarBusy) return;
  if (currentFile === filename && currentRoot === root) return;
  resetTemplatePreview();
  (document.getElementById('template-btn') as HTMLButtonElement).disabled = true;
  syncActiveTab();
  isLoadingFile = true;
  setEditorReadOnly(true);
  try {
     updateStatus('Loading...', '');
     clearValidationDetails();

    const cached = documents.tabs.get(tabKey(root, filename));
    const fileContent = cached?.snapshot ? null : await readFile(filename, root);
    if (cached?.snapshot) restoreEditor(cached.snapshot);
    await configureEditorForFile(filename);
    if (fileContent) setContent(fileContent.content, true);
    applyAppearanceSettings(getAppearanceSettings());
    currentFile = filename;
    currentRoot = root;
    selectedPath = root + '/' + filename;
    isModified = cached?.modified || false;
    documents.tabs.set(tabKey(root, filename), { root, path: filename, modified: isModified, snapshot: captureEditor() });
    documents.activate(tabKey(root, filename));
    if (saveBtnEl) saveBtnEl.setAttribute('aria-disabled', 'true');
    if (saveBtnMobileEl) saveBtnMobileEl.setAttribute('aria-disabled', 'true');


     isLoadingFile = false;
     isDocumentValid = true;
     validateCurrentDocument();
    updatePreview(filename);
    document.getElementById('document-hint')!.textContent = getEditorFileType(filename) === 'markdown' ? 'Markdown · preview omits embedded resources' : getEditorFileType(filename).toUpperCase();

    currentFilenameEl.textContent = filename;
    if (mobileFilenameEl) {
      // Show only the filename (not the full path) in the small toolbar label
      mobileFilenameEl.textContent = filename.split('/').pop() || filename;
    }

    // Update active file in list
    fileListEl.querySelectorAll('.tree-item').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-path') === selectedPath);
    });

    // Save state
    saveState();

    const sizeKB = ((fileContent?.size ?? new Blob([getContent()]).size) / 1024).toFixed(1);
    updateStatus(isModified ? 'Modified' : 'Ready', `${sizeKB} KB`);
  } catch (error) {
    console.error('Error loading file:', error);
    updateStatus(`Failed to load ${filename}`, '', true);
  } finally {
    isLoadingFile = false;
    setEditorReadOnly(!currentFile);
    (document.getElementById('template-btn') as HTMLButtonElement).disabled = !currentFile;
    const disabled = !isModified || !isDocumentValid;
    saveBtnEl.setAttribute('aria-disabled', String(disabled));
    saveBtnMobileEl.setAttribute('aria-disabled', String(disabled));
  }
}

/**
 * Save the current file
 * Sends file content to backend, creates backup, and updates UI
 */
async function handleSave(): Promise<void> {
  if (isSaving || isLoadingFile || isToolbarBusy || !currentFile || !isModified) return;
  isSaving = true;
  setEditorReadOnly(true);
  try {
    const structured = isStructuredFile(currentFile);
    if (structured && !validateCurrentDocument().isValid) {
      updateStatus('Cannot save invalid configuration', '', true);
      if (validationDetails && !isValidationDetailsOpen) toggleValidationDetails();
      return;
    }
    if (getAppearanceSettings().formatOnSave && structured) {
      updateStatus('Formatting...', 'Applying Prettier formatting');
      const formatted = await formatDocument(getContent(), getEditorFileType(currentFile));
      if (formatted !== getContent()) setContent(formatted);
      if (!validateCurrentDocument().isValid) {
        updateStatus('Cannot save formatted configuration', '', true);
        return;
      }
    }
    saveBtnEl.setAttribute('aria-disabled', 'true');
    saveBtnMobileEl.setAttribute('aria-disabled', 'true');
    clearValidationDetails();
    updateStatus('Saving...', '');
    await saveFile(currentFile, getContent(), currentRoot);
    isModified = false;
    if (currentRoot !== 'config' || !isYamlFile(currentFile)) {
      updateStatus('Saved', '');
      return;
    }
    updateStatus('Saved, checking config...', 'Running Home Assistant validation');
    const validation = await validateConfig();
    if (validation.result === 'valid') {
      updateStatus('Saved, config valid', 'HA validation passed', false, true);
    } else if (validation.result === 'invalid') {
      setValidationDetails('Home Assistant validation failed', validation.errors || 'Invalid configuration');
      updateStatus('Saved, config invalid', 'Click for details', true);
    } else {
      setValidationDetails('Home Assistant validation unavailable', validation.errors || 'Could not check Home Assistant config');
      updateStatus('Saved, validation unavailable', 'Click for details', false, false, true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateStatus('Failed to save', message, true);
    setValidationDetails('Save failed', message, false);
  } finally {
    isSaving = false;
    setEditorReadOnly(!currentFile);
    syncActiveTab();
    documents.render();
    const disabled = !isModified || !isDocumentValid;
    saveBtnEl.setAttribute('aria-disabled', String(disabled));
    saveBtnMobileEl.setAttribute('aria-disabled', String(disabled));
  }
}

/**
 * Update status bar
 */
function updateStatus(message: string, info: string, isError = false, isSuccess = false, isWarning = false): void {
  statusMessageEl.textContent = message;
  statusInfoEl.textContent = info;

  statusMessageEl.classList.remove('error', 'success', 'warning');

  if (isError) {
    statusMessageEl.classList.add('error');
  } else if (isSuccess) {
    statusMessageEl.classList.add('success');
  } else if (isWarning) {
    statusMessageEl.classList.add('warning');
  }
}

/**
 * Toggle mobile sidebar visibility
 */
function toggleMobileSidebar(): void {
  const isActive = sidebarEl.classList.contains('active');
  if (isActive) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

/**
 * Open mobile sidebar
 */
function openMobileSidebar(): void {
   sidebarEl.classList.add('active');
   sidebarOverlayEl.classList.add('active');
   mobileMenuToggleEl.setAttribute('aria-expanded', 'true');
}

/**
 * Close mobile sidebar
 */
function closeMobileSidebar(): void {
   sidebarEl.classList.remove('active');
   sidebarOverlayEl.classList.remove('active');
   mobileMenuToggleEl.setAttribute('aria-expanded', 'false');
}

// Start the application
init();
