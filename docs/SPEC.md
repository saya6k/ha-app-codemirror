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
  and fall back to raw `state`. Entity IDs are never translated. No browser-supplied
  templates or arbitrary upstream endpoints are accepted.
