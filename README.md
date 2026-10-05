# ha-app-codemirror

Source repo for the **CodeMirror** Home Assistant app — a CodeMirror 6 editor
for the Home Assistant configuration, served through the Ingress side panel.
Based on [roman-pinchuk/conf-edit-ha](https://github.com/roman-pinchuk/conf-edit-ha).

Install it from the [saya6k/ha-apps](https://github.com/saya6k/ha-apps)
catalog. This repo carries the source, Dockerfile, and CI; the catalog carries
the metadata.

- App docs: [codemirror/DOCS.md](codemirror/DOCS.md)
- Original MIT license: [LICENSE.md](LICENSE.md)

## Release flow

1. Merge to `main` — release-drafter updates the draft.
2. Publish the draft → `build.yml` pushes `ghcr.io/saya6k/app-codemirror:{ver}`.
3. The build dispatches to ha-apps, which opens a version-bump PR.

## Development

Python 3.12+ and Node.js 22.12+.

```sh
python3 -m venv .venv
.venv/bin/pip install -r codemirror/requirements.txt
npm --prefix codemirror/frontend ci
npm --prefix codemirror/frontend run build
.venv/bin/python -m unittest discover -s codemirror/tests -v
CONFIG_DIR="$PWD/codemirror/test-config" .venv/bin/python codemirror/app.py
```

Browser tests use isolated temporary files on port 18099 and never touch a
real Home Assistant configuration:

```sh
cd codemirror/frontend
npx playwright install chromium
npm test
```

Container smoke test (builds the image when no tag is given):

```sh
sh scripts/smoke.sh [image-tag]
```
