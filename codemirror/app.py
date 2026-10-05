#!/usr/bin/env python3
"""
Lightweight Configuration Editor for Home Assistant
Flask backend with API endpoints for file operations and HA entity discovery
"""

from flask import Flask, jsonify, request, send_from_directory, send_file
import requests
import os
import errno
from threading import Lock
from werkzeug.exceptions import (HTTPException, Forbidden, BadRequest, BadGateway,
                                 ServiceUnavailable, GatewayTimeout, Conflict, NotFound)
import filesystem
import logging
import json
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static', static_url_path='')

# Configuration
SUPERVISOR_URL = 'http://supervisor'
HA_URL = f'{SUPERVISOR_URL}/core/api'
TOKEN = os.getenv('SUPERVISOR_TOKEN', '')
PORT = 8099

# Root paths are deployment configuration, never supplied by a browser.
CONFIG_DIR = os.getenv('CONFIG_DIR', '/config')
ROOT_PATHS = {
    'config': Path(CONFIG_DIR),
    'local_apps': Path('/addons'),
    'media': Path('/media'),
    'addon_configs': Path('/addon_configs'),
    'ssl': Path('/ssl'),
    'share': Path('/share'),
}
OPTIONS_FILE = Path(os.getenv('OPTIONS_FILE', '/data/options.json'))
DEFAULT_SETTINGS = {'indent_style': 'spaces', 'indent_opacity': 100}
write_lock = Lock()
ha_control_lock = Lock()
template_lock = Lock()


def read_options():
    try:
        value = json.loads(OPTIONS_FILE.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def upload_limit():
    value = read_options().get('max_upload_mb', 32)
    if type(value) is not int or not 1 <= value <= 512:
        value = 32
    return value * 1024 * 1024


def selected_root(root_id=None):
    if root_id is None:
        root_id = request.args.get('root', 'config')
    if not isinstance(root_id, str):
        raise BadRequest('Workspace must be a string')
    if root_id not in ROOT_PATHS:
        raise Forbidden('Unknown workspace')
    if root_id != 'config' and read_options().get(f'allow_{root_id}') is not True:
        raise Forbidden('Workspace access is disabled in app options')
    return ROOT_PATHS[root_id]


@app.before_request
def protect_request():
    # Supervisor authenticates ingress. Never trust a spoofable forwarded header.
    if (TOKEN or os.getenv('CODEMIRROR_INGRESS_ONLY') == '1') and request.path != '/health' and request.remote_addr != '172.30.32.2':
        raise Forbidden('Use Home Assistant Ingress to access this app')
    if request.method in ('POST', 'PUT', 'DELETE', 'PATCH'):
        if request.headers.get('X-CodeMirror-Request') != '1':
            raise Forbidden('Missing same-origin request header')
    request.max_content_length = (upload_limit() + 1024 * 1024
                                  if request.path in ('/api/upload', '/api/upload-folder')
                                  else 6 * filesystem.MAX_TEXT_BYTES + 1024)


@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
    )
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/api/roots')
def list_roots():
    options = read_options()
    roots = [{'id': key, 'label': '/addons' if key == 'local_apps' else '/' + key,
              'available': path.is_dir() and not path.is_symlink()}
             for key, path in ROOT_PATHS.items()
             if key == 'config' or options.get(f'allow_{key}') is True]
    return jsonify({'roots': roots, 'max_upload_bytes': upload_limit()})


# Ensure we have the token
if not TOKEN:
    logger.warning("SUPERVISOR_TOKEN not found in environment")


@app.route('/')
def index():
    """Serve the main HTML file"""
    return send_file('static/index.html')


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    """Serve static assets"""
    return send_from_directory('static/assets', filename)


@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'}), 200


@app.route('/api/settings')
def get_settings():
    """Return validated editor settings from Home Assistant app options."""
    settings = DEFAULT_SETTINGS.copy()

    try:
        with OPTIONS_FILE.open(encoding='utf-8') as options_file:
            options = json.load(options_file)

        indent_style = options.get('indent_style')
        if indent_style in ('spaces', 'lines'):
            settings['indent_style'] = indent_style
        elif indent_style == 'dotted':
            settings['indent_style'] = 'lines'

        opacity = options.get('indent_opacity')
        if isinstance(opacity, int) and not isinstance(opacity, bool):
            settings['indent_opacity'] = max(0, min(100, opacity))
    except (OSError, json.JSONDecodeError, AttributeError):
        logger.info("Using default editor settings")

    return jsonify(settings), 200


def ha_request(method, path, *, supervisor=False, timeout=60, payload=None, plain_text=False):
    """Call a fixed internal API path. Never retry a potentially mutating request."""
    if not TOKEN:
        raise ServiceUnavailable('Home Assistant supervisor token is not configured')
    base = SUPERVISOR_URL if supervisor else HA_URL
    headers = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}
    try:
        if method == 'GET':
            response = requests.get(f'{base}{path}', headers=headers, timeout=(5, timeout))
        else:
            response = requests.post(f'{base}{path}', headers=headers, json=payload or {}, timeout=(5, timeout))
        response.raise_for_status()
        return response.text if plain_text else response.json()
    except requests.Timeout:
        raise GatewayTimeout('Home Assistant request timed out. Completion is unknown; check HA before retrying.') from None
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else 502
        if status in (401, 403):
            raise Forbidden('Home Assistant API access denied. Check homeassistant_api, hassio_api and hassio_role.') from None
        if plain_text and status == 400:
            try:
                body = error.response.json()
                message = body.get('message') if isinstance(body, dict) else None
            except ValueError:
                message = None
            detail = message if isinstance(message, str) else 'Home Assistant could not render this template'
            raise BadRequest(detail.replace(TOKEN, '[redacted]')[:2000]) from None
        raise BadGateway(f'Home Assistant API returned HTTP {status}') from None
    except requests.RequestException:
        raise BadGateway('Could not connect to Home Assistant API; the request was not retried') from None
    except ValueError:
        raise BadGateway('Home Assistant returned invalid JSON') from None


@app.route('/api/template', methods=['POST'])
def render_template():
    body = request.get_json(silent=True)
    template = body.get('template') if isinstance(body, dict) else None
    if not isinstance(template, str) or not template.strip():
        raise BadRequest('Provide a non-empty template string')
    try:
        size = len(template.encode('utf-8'))
    except UnicodeEncodeError:
        raise BadRequest('Template must contain valid Unicode') from None
    if size > 65536:
        raise BadRequest('Template exceeds the 64 KiB limit')
    if not template_lock.acquire(blocking=False):
        raise Conflict('Another template is rendering. Try again shortly.')
    try:
        result = ha_request('POST', '/template', timeout=10,
                            payload={'template': template}, plain_text=True)
        return jsonify({'result': result})
    finally:
        template_lock.release()


def check_saved_config():
    result = ha_request('POST', '/config/core/check_config')
    if not isinstance(result, dict) or result.get('result') not in ('valid', 'invalid'):
        raise BadGateway('Home Assistant returned an invalid validation response')
    errors = result.get('errors')
    if errors is not None and not isinstance(errors, str):
        raise BadGateway('Home Assistant returned invalid validation details')
    return {'result': result['result'], 'errors': errors}


@app.route('/api/entities')
def get_entities():
    states = ha_request('GET', '/states', timeout=10)
    if not isinstance(states, list):
        raise BadGateway('Home Assistant returned an invalid entity list')
    entities = []
    for state in states:
        if (not isinstance(state, dict) or not isinstance(state.get('entity_id'), str) or
                not isinstance(state.get('state'), str) or
                not isinstance(state.get('attributes', {}), dict)):
            raise BadGateway('Home Assistant returned an invalid entity')
        name = state.get('attributes', {}).get('friendly_name', state['entity_id'])
        entities.append({'entity_id': state['entity_id'], 'state': state['state'],
                         'friendly_name': name if isinstance(name, str) else state['entity_id'],
                         'domain': state['entity_id'].split('.')[0]})
    if entities:
        # Entity translation always uses a fixed server-owned template.
        template = ('{ {% for s in states %}{{ s.entity_id | to_json }}: '
                    '{{ state_translated(s.entity_id) | to_json }}'
                    '{% if not loop.last %},{% endif %}{% endfor %} }')
        try:
            translated = ha_request('POST', '/template', timeout=10, payload={'template': template})
            if not isinstance(translated, dict):
                raise BadGateway('Invalid translated states')
            for entity in entities:
                value = translated.get(entity['entity_id'])
                if isinstance(value, str):
                    entity['state_translated'] = value
        except HTTPException:
            logger.warning('Translated entity states unavailable; showing raw states')
    return jsonify(entities)


@app.route('/api/services')
def get_services():
    services = ha_request('GET', '/services', timeout=10)
    if not isinstance(services, list):
        raise BadGateway('Home Assistant returned an invalid service list')
    return jsonify(services)


@app.route('/api/validate', methods=['POST'])
def validate_config():
    """Validate saved HA configuration; browser buffer validation is separate."""
    try:
        return jsonify(check_saved_config())
    except HTTPException as error:
        return jsonify({'result': 'unavailable', 'errors': error.description}), error.code


@app.route('/api/ha/<action>', methods=['POST'])
def control_home_assistant(action):
    reloads = {
        'reload': ('homeassistant/reload_all', 'Reload request completed for reloadable YAML configuration.'),
        'reload-automations': ('automation/reload', 'Automations reload completed.'),
        'reload-scripts': ('script/reload', 'Scripts reload completed.'),
        'reload-groups': ('group/reload', 'Groups reload completed.'),
        'reload-core': ('homeassistant/reload_core_config', 'Core configuration reload completed.'),
    }
    if action != 'restart' and action not in reloads:
        raise NotFound('Unknown Home Assistant action')
    if not ha_control_lock.acquire(blocking=False):
        raise Conflict('Another Home Assistant action is already running')
    try:
        validation = check_saved_config()
        if validation['result'] != 'valid':
            return jsonify({'error': 'Saved Home Assistant configuration is invalid',
                            'details': validation['errors']}), 422
        if action == 'restart':
            result = ha_request('POST', '/core/restart', supervisor=True, timeout=90)
            if not isinstance(result, dict) or result.get('result') != 'ok':
                raise BadGateway('Supervisor could not complete the restart request')
            message = 'Home Assistant restart request completed. The UI may reconnect shortly.'
        else:
            service, message = reloads[action]
            result = ha_request('POST', '/services/' + service, timeout=90)
            if not isinstance(result, list):
                raise BadGateway('Home Assistant returned an invalid reload response')
        logger.info('Home Assistant %s request completed', action)
        return jsonify({'success': True, 'message': message})
    finally:
        ha_control_lock.release()


@app.route('/api/entries', methods=['POST'])
def create_entry():
    root = selected_root()
    data = request.get_json()
    if not isinstance(data, dict):
        raise BadRequest('Expected an entry object')
    with write_lock:
        result = filesystem.create_entry(root, data.get('directory', ''),
                                         data.get('name'), data.get('type'))
    return jsonify(result), 201


@app.route('/api/entries/action', methods=['POST'])
def entry_action():
    from file_actions import operate
    data = request.get_json()
    if not isinstance(data, dict):
        raise BadRequest('Expected an action object')
    root = selected_root()
    target = selected_root(data.get('destination_root', request.args.get('root', 'config')))
    with write_lock:
        operate(root, data.get('path'), data.get('action'), target, data.get('destination'))
    return jsonify({'success': True})


@app.route('/api/directory')
def list_directory():
    root = selected_root()
    try:
        offset = int(request.args.get('offset', '0'))
    except ValueError:
        raise BadRequest('Invalid directory offset')
    if offset < 0:
        raise BadRequest('Invalid directory offset')
    return jsonify(filesystem.directory_page(root, request.args.get('path', ''), offset))


@app.route('/api/files')
def list_files():
    return jsonify(filesystem.file_tree(selected_root()))


@app.route('/api/files/<path:filename>')
def read_file(filename):
    return jsonify(filesystem.read_text(selected_root(), filename))


@app.route('/api/files/<path:filename>', methods=['PUT'])
def write_file(filename):
    root = selected_root()
    data = request.get_json()
    if not isinstance(data, dict) or not isinstance(data.get('content'), str):
        raise BadRequest('Content must be a string')
    with write_lock:
        size = filesystem.save_text(root, filename, data['content'])
    logger.info('Saved file in workspace %s', request.args.get('root', 'config'))
    return jsonify({'success': True, 'filename': filename, 'size': size})


@app.route('/api/upload', methods=['POST'])
def upload_file():
    root = selected_root()
    files = request.files.getlist('file')
    if len(files) != 1:
        raise BadRequest('Send one file per request')
    with write_lock:
        size = filesystem.upload(root, request.form.get('directory', ''), files[0], upload_limit())
    logger.info('Uploaded file to workspace %s', request.args.get('root', 'config'))
    return jsonify({'success': True, 'filename': files[0].filename, 'size': size}), 201


@app.route('/api/upload-folder', methods=['POST'])
def upload_folder():
    from archive_upload import extract_folder
    root = selected_root()
    files = request.files.getlist('file')
    if len(files) != 1:
        raise BadRequest('Send one folder ZIP per request')
    with write_lock:
        result = extract_folder(root, request.form.get('directory', ''), files[0].stream, upload_limit())
    return jsonify(result), 201


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify({'error': error.description}), error.code


@app.errorhandler(UnicodeError)
def text_error(_error):
    return jsonify({'error': 'File is not UTF-8 text'}), 400


@app.errorhandler(OSError)
def filesystem_error(error):
    if error.errno == errno.ENOENT:
        return jsonify({'error': 'File or directory not found'}), 404
    if error.errno in (errno.EACCES, errno.EPERM, errno.ELOOP, errno.ENOTDIR, errno.EISDIR):
        return jsonify({'error': 'Access denied'}), 403
    logger.exception('File operation failed')
    return jsonify({'error': 'File operation failed'}), 500


if __name__ == '__main__':
    logger.info("Starting Configuration Editor on port %d", PORT)
    logger.info("Config directory: %s", CONFIG_DIR)
    logger.info("Token configured: %s", 'Yes' if TOKEN else 'No')

    app.run(
        host='0.0.0.0' if TOKEN else '127.0.0.1',
        port=PORT,
        debug=False
    )
