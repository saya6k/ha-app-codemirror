# Home Assistant notes

Open **Preview Markdown** to see this document alongside the editor.

## Before changing configuration

1. Open a YAML file and edit it.
2. Save with Ctrl/Cmd+S. The previous version is kept as `.backup`.
3. Review the Home Assistant validation result.

| Workspace | Default access |
| --- | --- |
| `/config` | Allowed |
| `/addons`, `/media`, `/addon_configs`, `/ssl`, `/share` | Opt-in |

```yaml
allow_media: true
allow_share: true
```

Files can be uploaded with the file picker or dropped onto a folder in the tree.
