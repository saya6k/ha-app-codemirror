"""Isolated fixture server for the browser suite; never uses real HA files."""
import json
import logging
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server

with tempfile.TemporaryDirectory(prefix='codemirror-browser-') as temp:
    base = Path(temp)
    server.TOKEN = ''
    server.app.view_functions['get_entities'] = lambda: server.jsonify([])
    server.ROOT_PATHS = {key: base / key for key in server.ROOT_PATHS}
    for root in server.ROOT_PATHS.values():
        root.mkdir()
    config = server.ROOT_PATHS['config']
    (config / 'docs').mkdir()
    (config / 'guide.md').write_text('# Home Assistant\n\nA **Markdown** workspace.\n\n| Feature | Status |\n| --- | --- |\n| Upload | Ready |\n')
    (config / 'other.md').write_text('# Other document\n')
    (config / 'configuration.yaml').write_text('homeassistant:\n  name: Home\n')
    (config / 'data.json').write_text('{"enabled": true}\n')
    (config / 'unsafe.markdown').write_text('# Preview safety\n<script>window.previewUnsafe = true</script>\n<img src="https://example.com/tracker" onerror="window.previewUnsafe = true">\n[bad](javascript:alert(1))\n[local](/api/validate)')
    (config / 'quotes " & <test>.md').write_text('# Filename escaping\n')
    (server.ROOT_PATHS['media'] / 'media.md').write_text('# Media workspace\n')
    server.OPTIONS_FILE = base / 'options.json'
    server.OPTIONS_FILE.write_text(json.dumps({'max_upload_mb': 1}))
    server.WORKSPACES_FILE = base / 'workspaces.json'
    server.WORKSPACES_FILE.write_text(json.dumps({'enabled': ['config', 'media']}))
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    server.app.run(host='127.0.0.1', port=18099, debug=False)
