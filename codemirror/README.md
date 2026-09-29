# CodeMirror

Home Assistant Ingress app based on
[roman-pinchuk/conf-edit-ha](https://github.com/roman-pinchuk/conf-edit-ha).

CodeMirror 6 editing for YAML, JSON, Python, shell and Markdown, live Markdown
preview, entity completion, configuration checking, backups, Korean/English UI settings, document tabs
and folder-aware drag-and-drop uploads. The unified explorer provides context-menu creation, rename, delete and cut/copy/paste
for files and directories. The header menu validates configuration, reloads YAML and
restarts Core. Entity dropdowns support ID substrings, friendly names, keyboard
selection and Home Assistant state_translated values. Folder uploads compress in the
browser and extract safely on the server. Official CodeMirror branding is preserved
with its source and license in [branding](branding/README.md).

All requested workspaces are mounted. Only `/config` is accessible by default;
enable each additional directory with its `allow_*` option in the app configuration.

See [DOCS.md](DOCS.md) for configuration and usage, and
[LICENSE.md](LICENSE.md) for the original MIT license and copyright notice.
