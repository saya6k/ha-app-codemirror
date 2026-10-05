# CodeMirror Home Assistant app

## Objective and acceptance criteria

Extend roman-pinchuk/conf-edit-ha at commit
`aedc087b41b6f733076cf75ff98efc050603a162` (MIT, attribution retained).
Preserve CodeMirror 6 YAML/JSON/Python/shell editing, local validation,
HA entity completion and config checking, backups, appearance controls,
format-on-save, mobile tools and last-file persistence.

- Markdown (`.md`, `.markdown`): highlighting, editing, saving and sanitized preview.
- Always mount HA config at `/config`, local apps at `/addons`, media at `/media`,
  all app configs at `/addon_configs`, certificates at `/ssl`, shared files at `/share`.
- Only `/config` is accessible by default. Five independent boolean options opt
  into the other roots. Enforce on every server file operation; never trust the UI.
- Root selector only offers enabled mounts. Files and folders are browsable.
- Multiple file upload via drop or accessible file picker into the selected folder.
  Binary uploads supported; conflicts rejected without overwriting existing files.
  Report per-file results and refresh the tree. Reject directory drops explicitly.
- Reject traversal, symbolic links, special files and hard links. Atomic saves
  and backups must not write through a malicious backup symlink.
- Ingress-only production access; no published unauthenticated host port.

## Stack and structure

`codemirror/app.py`: Flask API + HA integration.
`codemirror/filesystem.py`: capability-based rooted file operations.
`codemirror/frontend/`: upstream TypeScript/CodeMirror/Vite UI with extensions.
`codemirror/tests/`: Python unittest API/security regressions.
`codemirror/config.yaml`, `Dockerfile`, `run.sh`: installable local app.
`docs/`: design and upstream provenance; `codemirror/DOCS.md`: user configuration.

## Commands

```sh
python3 -m venv .venv
.venv/bin/pip install -r codemirror/requirements.txt
.venv/bin/python -m unittest discover -s codemirror/tests -v
npm --prefix codemirror/frontend ci
npm --prefix codemirror/frontend run build
CONFIG_DIR="$PWD/codemirror/test-config" .venv/bin/python codemirror/app.py
docker build -t ha-codemirror codemirror
```

## Style

Retain upstream conventions: Python snake_case, four spaces; TypeScript
camelCase, two spaces, explicit API interfaces. Keep permission decisions on
the server, with a fixed root ID allowlist, e.g. `options.get('allow_media') is True`.

## Test strategy and boundaries

Write failing API tests for opt-in, traversal, symlink escapes, backup safety,
upload conflicts/limits and Markdown round trips, then implement. Build with
TypeScript checks and verify real browser workflows when browser tooling is
available. Container/HA runtime validation needs Docker/Supervisor.

Always preserve upstream license, fail closed on malformed options, test new
behavior and document mount-vs-application permissions. Never expose tokens,
silently overwrite uploads or allow the browser to choose arbitrary host paths.
Publishing/deployment is outside this implementation request.

## Implementation sequence

1. Import upstream, record provenance and scaffold the local app.
2. Test and implement root permissions and safe file/upload APIs.
3. Add Markdown, root/folder selection and upload interactions.
4. Run backend tests, frontend build and browser workflows; document installation.

## Sources

- https://github.com/roman-pinchuk/conf-edit-ha
- https://developers.home-assistant.io/docs/apps/configuration/
- https://developers.home-assistant.io/docs/apps/presentation/#ingress
- https://github.com/codemirror/lang-markdown
- https://marked.js.org/ (HTML output requires sanitization)
- https://github.com/cure53/DOMPurify

## 0.2.0: file creation and Home Assistant controls

- A top toolbar, also visible on mobile: New file, New directory, Validate YAML,
  Reload YAML, Restart HA, Refresh entities and connection/entity feedback.
- `POST /api/entries?root=...`: `{directory, name, type}` creates a file or directory
  in an existing parent. Returns `{path, type}` with 201; 409 on conflicts,
  403 on inaccessible roots/links/traversal, 400 on invalid names/types. No overwrite.
  New files use supported text extensions; JSON starts as `{}` and other files empty.
- Creation uses the selected workspace/folder, refreshes the tree and opens new
  files without discarding unsaved work without the existing confirmation.
- Validate YAML checks the current YAML/JSON buffer locally and saved HA config
  through the Core API. Unsaved-buffer validation is explicitly distinguished
  from the server's saved-configuration check.
- `POST /api/ha/reload` invokes `homeassistant.reload_all`; `POST /api/ha/restart`
  invokes Supervisor `/core/restart`. Both require a successful server-side config
  check first, allow only these fixed actions, serialize control operations,
  preserve timeout/permission failures, and never automatically retry actions.
  UI blocks these actions while edits are unsaved, confirms restart, and reports results.
- Entity suggestions show a real CodeMirror dropdown: automatic YAML value context,
  explicit Ctrl+Space/toolbar activation even with an empty prefix, substring and
  friendly-name filtering, Arrow/Enter selection and Escape dismissal. Refreshable
  entity data has a visible success/empty/unavailable state.
- Add `hassio_api: true`, `hassio_role: homeassistant`; keep `homeassistant_api: true`.
- Use the supported token-authenticated Supervisor HTTP proxy. Epic #32 describes
  the Supervisor-to-Core Unix socket, not an app-facing socket API. Document the
  evidence and do not mount internal sockets or add privileged host access.
- Verify API permission/conflict/error cases, mock HA lifecycle endpoints (never
  restart a user's system in tests), and exercise toolbar/autocomplete in Chrome.

## 0.3.0: unified explorer and translated entity states

- Supersedes the workspace/folder selectors and action toolbar above. All allowed
  roots appear as top-level tree nodes. Selection and open-document identity are
  separate; selecting another root does not change the destination of Save.
- Creation/upload/paste target the selected folder, or a selected file's parent.
  Context menus support creation, recursive rename/delete/copy/cut/paste and upload;
  the sidebar overflow button provides the same actions on touch devices.
- Header overflow retains HA controls and entity refresh. Keyboard tree navigation,
  F2, Delete, Ctrl/Cmd+X/C/V and Shift+F10 are supported within the explorer.
- `POST /api/entries/action?root=...`: `{action: copy|move|delete, path,
  destination_root?, destination?}`. Both roots require access. Empty source paths
  cannot mutate mounted roots; links, traversal, descendants and overwrites are
  rejected. Recursive operations are limited to 10000 entries, 32 levels, 512 MiB.
- Copy publishes a staged entry with exclusive rename. Same-filesystem move uses
  exclusive rename; cross-device move copies then removes the source. A failed
  source removal reports that both copies may remain. Delete is permanent and
  confirmed in the UI. Unsaved affected documents must be saved first.
- A fixed Core `/template` request evaluates `state_translated(s.entity_id)` for
  states. The entity API adds optional `state_translated`; suggestions prefer it
  and fall back to raw `state`. Entity IDs are never translated. The entity API
  never accepts browser-supplied templates or arbitrary upstream endpoints.

## 0.4.0: localization, branding, tabs and folder archives

- Appearance exposes `auto | en | ko`, stored in `codemirror:language`. Auto follows
  the browser. App chrome and `EditorState.phrases` are localized; editor contents,
  filenames, entity IDs and Markdown preview are excluded. HA translated states
  continue to follow HA settings independently of the app locale.
- Use the official CodeMirror website SVG unchanged; rasterize to transparent
  256px icon.png and 640px logo.png. Bundle the source, provenance and MIT notice.
- Tabs are keyed by root + path and retain full EditorState plus last-valid content
  and scroll position. Save applies to the active tab. Close confirms dirty state.
  Unsaved inactive tabs also block affected file mutations and HA lifecycle actions.
  Buffers are memory-only; the existing last-open-file persistence stays disk-based.
- `POST /api/upload-folder?root=...` accepts multipart `directory` and one ZIP `file`.
  Browser folder selection/drop is compressed incrementally using fflate, with no
  worker/blob CSP relaxation. A single top-level directory is staged then published
  by exclusive rename. Nested binaries and Unicode names are preserved.
- Reject unsafe/duplicate/conflicting paths, encrypted ZIP, nonregular entries,
  unsupported compression, CRC errors and expansion over max_upload_mb. Limits:
  10000 explicit/implicit entries and 32 levels including the selected destination.
  Existing folders are never merged. Empty directories are preserved by the drop
  API; webkitdirectory pickers may omit empty directories.
- Git initialized on main, with the original 0.3.0 source captured as the initial commit.


## 0.4.1: incremental directory discovery

- Explorer uses `GET /api/directory?root=<id>&path=<relative>&offset=<n>`.
  It returns `{entries: FileInfo[], next_offset: number|null}` and performs no
  recursive descent. Existing `/api/files` remains a bounded recursive legacy API.
- Each page examines at most 500 directory entries after skipping the offset;
  excluded/vanished entries may leave a short or empty page with a next offset.
  Offsets use filesystem enumeration order, not a snapshot. Refresh after external
  mutations; ordering is sorted across loaded entries in the browser.
- Root opt-in and descriptor-based path/link protection apply to every page.
  A deep, large or unreadable descendant cannot fail its parent's listing.
- Render roots immediately, load expanded directories independently, cache until
  explicit/mutation refresh, and discard stale responses after refresh.
- Restore the saved document without waiting for tree discovery or entity state
  translations. Directory fetches time out after 15 seconds. Errors appear below
  the directory as escaped, wrapping text with an explicit retry button.

## 0.5.0: Home Assistant template preview

### MDI icon completion and preview

- YAML and JSON `mdi:` tokens offer at most 80 canonical icon names, matching
  substrings with prefix matches first. Preserve quotes and replace the complete
  token when completion starts in the middle. Suppress entity suggestions there.
- Display actual SVG glyphs in completion options and larger previews in completion
  info/hover tooltips. Ignore unknown names and comments; support keyboard selection
  and mobile list previews using theme colors.
- Build a name/path catalog from pinned official `@mdi/svg` 7.4.47 (7,447 icons).
  Load it once through a local dynamic import on first icon interaction; no CDN
  calls or HA requests. Emit the upstream license as `MDI-LICENSE.txt` in the build.
- Catalog size is approximately 2.7 MB (807 kB gzipped); it is a separate lazy chunk
  and is not part of editor startup. The installed HA release may use a different
  icon version. Source: https://pictogrammers.com/docs/contribute/third-party/

### Home Assistant controls and templates

The Home Assistant menu also exposes `POST /api/ha/reload-automations`,
`reload-scripts`, `reload-groups` and `reload-core`, mapped to fixed services
`automation.reload`, `script.reload`, `group.reload` and
`homeassistant.reload_core_config`. All retain configuration validation,
unsaved-tab protection, the shared control lock and no automatic retry.
A normal link to `https://materialdesignicons.com` opens a new tab with
`noopener noreferrer`, including on mobile.

- `POST /api/template` accepts `{template: string}` (nonblank, valid Unicode,
  at most 64 KiB UTF-8) and returns `{result: string}` preserving plain text.
  Use the fixed Supervisor Core `/template` endpoint with a 10-second read timeout,
  existing Ingress/header protection and one concurrent rendering request.
- Render the unsaved selection, or the entire buffer if nothing is selected.
  YAML is not parsed into individual templates. Show scope, loading, empty results,
  HA template errors, connection errors and a rerun action in a mobile-ready panel.
- After 700 ms hovering a single-line `{{ ... }}` expression, show an inert tooltip.
  Parse quoted delimiters and nested dictionary braces; skip documents containing
  block/comment tags since they may define context or raw regions. Cache only the
  last successful hover result for five seconds; explicit panel runs remain fresh.
- Abort/discard obsolete results after editing, tooltip dismissal or document
  navigation. Never insert result HTML or translate rendered HA output.
- HA states/functions are available; automation runtime variables are not injected.
  Rendering does not save files, reload configuration, or execute automations.
