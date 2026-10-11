import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server


class FileAPITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.roots = {key: self.base / key for key in
                      ('config', 'local_apps', 'media', 'addon_configs', 'ssl', 'share')}
        for root in self.roots.values():
            root.mkdir()
            (root / 'test.md').write_text('# Original\n')
        self.options = self.base / 'options.json'
        self.options.write_text('{}')
        self.workspaces = self.base / 'workspaces.json'
        self.patch = patch.multiple(server, ROOT_PATHS=self.roots, OPTIONS_FILE=self.options,
                                    WORKSPACES_FILE=self.workspaces)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.client = server.app.test_client()
        self.headers = {'X-CodeMirror-Request': '1'}

    def opt_in(self, *roots):
        self.workspaces.write_text(json.dumps({'enabled': ['config', *roots]}))

    def upload(self, root='config', name='image.png', content=b'\x00image', directory=''):
        return self.client.post(f'/api/upload?root={root}', headers=self.headers,
                                data={'directory': directory,
                                      'file': (io.BytesIO(content), name)})

    def test_directory_listing_is_lazy_and_paged(self):
        root = self.roots['share']
        deep = root / 'deep'
        deep.mkdir()
        for _ in range(34):
            deep = deep / 'child'
            deep.mkdir()
        self.assertEqual(self.client.get('/api/directory?root=share').status_code, 403)
        self.opt_in('share')
        # The legacy recursive scan fails, but the explorer lists this root.
        self.assertEqual(self.client.get('/api/files?root=share').status_code, 400)
        result = self.client.get('/api/directory?root=share').json
        self.assertEqual({n['name'] for n in result['entries']}, {'test.md', 'deep'})
        self.assertNotIn('children', next(n for n in result['entries'] if n['name'] == 'deep'))
        for i in range(510):
            (root / f'{i}.txt').touch()
        seen = []
        offset = 0
        while offset is not None:
            page = self.client.get(f'/api/directory?root=share&offset={offset}').json
            self.assertLessEqual(len(page['entries']), 500)
            seen.extend(n['path'] for n in page['entries'])
            offset = page['next_offset']
        self.assertEqual(len(seen), 512)
        self.assertEqual(len(set(seen)), 512)

    def test_directory_listing_rejects_escape_and_links(self):
        root = self.roots['config']
        (root / 'linked').symlink_to(self.roots['share'], target_is_directory=True)
        for path in ('../share', 'linked'):
            self.assertEqual(self.client.get('/api/directory', query_string={'path': path}).status_code, 403)
        self.assertEqual(self.client.get('/api/directory?offset=-1').status_code, 400)
        self.assertEqual(self.client.get('/api/directory?offset=no').status_code, 400)
        self.assertNotIn('linked', [n['name'] for n in self.client.get('/api/directory').json['entries']])

    def test_defaults_only_expose_config(self):
        roots = self.client.get('/api/roots').json['roots']
        self.assertEqual([r['id'] for r in roots if r['enabled']], ['config'])
        self.assertEqual([r['id'] for r in roots], list(self.roots))
        for root in self.roots:
            if root == 'config':
                continue
            with self.subTest(root=root):
                self.assertEqual(self.client.get(f'/api/files?root={root}').status_code, 403)
                self.assertEqual(self.client.get(f'/api/files/test.md?root={root}').status_code, 403)
                self.assertEqual(self.client.put(f'/api/files/test.md?root={root}',
                    json={'content': 'changed'}, headers=self.headers).status_code, 403)
                self.assertEqual(self.upload(root).status_code, 403)

    def test_each_root_is_independently_opt_in_and_revocable(self):
        for root in self.roots:
            if root == 'config':
                continue
            with self.subTest(root=root):
                self.opt_in(root)
                self.assertEqual(self.client.get(f'/api/files/test.md?root={root}').status_code, 200)
                self.assertEqual(self.client.put(f'/api/files/test.md?root={root}',
                    json={'content': '# Updated'}, headers=self.headers).status_code, 200)
                self.assertEqual(self.upload(root).status_code, 201)
                self.opt_in()
                self.assertEqual(self.client.get(f'/api/files/test.md?root={root}').status_code, 403)

    def test_workspace_state_fails_closed(self):
        for raw in ('{"enabled": "ssl"}', '{"ssl": true}', 'null', '[]', '{'):
            self.workspaces.write_text(raw)
            self.assertEqual(self.client.get('/api/files?root=ssl').status_code, 403)
            self.assertEqual(self.client.get('/api/files?root=config').status_code, 200)

    def test_workspaces_toggle_at_runtime_and_persist(self):
        def toggle(root, value, headers=self.headers):
            return self.client.put(f'/api/roots/{root}', json={'enabled': value}, headers=headers)
        self.assertEqual(toggle('ssl', True, headers={}).status_code, 403)
        self.assertEqual(self.client.get('/api/files?root=ssl').status_code, 403)
        response = toggle('ssl', True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r['id'] for r in response.json['roots'] if r['enabled']], ['config', 'ssl'])
        self.assertEqual(json.loads(self.workspaces.read_text()), {'enabled': ['config', 'ssl']})
        self.assertEqual(self.client.get('/api/files/test.md?root=ssl').status_code, 200)
        self.assertEqual(toggle('ssl', False).status_code, 200)
        self.assertEqual(self.client.get('/api/files/test.md?root=ssl').status_code, 403)
        self.assertEqual(toggle('unknown', True).status_code, 403)
        self.assertEqual(toggle('ssl', 'true').status_code, 400)
        self.assertEqual(toggle('config', False).status_code, 200)
        self.assertEqual(self.client.get('/api/files?root=config').status_code, 403)
        self.assertEqual([r['id'] for r in self.client.get('/api/roots').json['roots'] if r['enabled']], [])
        self.assertEqual(toggle('config', True).status_code, 200)
        self.assertEqual(self.client.get('/api/files?root=config').status_code, 200)

    def test_markdown_roundtrip_and_backup(self):
        path = self.roots['config'] / 'test.md'
        path.chmod(0o600)
        owner = (path.stat().st_uid, path.stat().st_gid)
        result = self.client.put('/api/files/test.md', json={'content': '# 한국어\n'}, headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get('/api/files/test.md').json['content'], '# 한국어\n')
        self.assertEqual((self.roots['config'] / 'test.md.backup').read_text(), '# Original\n')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual((path.stat().st_uid, path.stat().st_gid), owner)
        self.assertEqual((self.roots['config'] / 'test.md.backup').stat().st_mode & 0o777, 0o600)

    def test_traversal_unknown_roots_and_absolute_paths_rejected(self):
        for path in ('../ssl/test.md', '%2E%2E/ssl/test.md', 'folder/../../ssl/test.md', 'a%5Cb.md'):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(f'/api/files/{path}').status_code, 403)
        self.assertEqual(self.client.get('/api/files?root=/ssl').status_code, 403)
        self.assertEqual(self.upload(directory='/ssl').status_code, 403)
        self.assertEqual(self.upload(directory='../ssl').status_code, 403)

    def test_symlinks_are_blocked_in_read_write_tree_and_upload(self):
        root = self.roots['config']
        (root / 'escape.md').symlink_to(self.roots['ssl'] / 'test.md')
        (root / 'escape').symlink_to(self.roots['ssl'], target_is_directory=True)
        (root / 'loop').symlink_to(root, target_is_directory=True)
        for path in ('escape.md', 'escape/test.md'):
            self.assertEqual(self.client.get(f'/api/files/{path}').status_code, 403)
            self.assertEqual(self.client.put(f'/api/files/{path}', json={'content': 'oops'},
                                            headers=self.headers).status_code, 403)
        self.assertEqual(self.upload(directory='escape').status_code, 403)
        self.assertEqual([f['name'] for f in self.client.get('/api/files').json], ['test.md'])

    def test_backup_symlink_never_changes_external_file(self):
        outside = self.roots['ssl'] / 'test.md'
        (self.roots['config'] / 'test.md.backup').symlink_to(outside)
        result = self.client.put('/api/files/test.md', json={'content': 'new'}, headers=self.headers)
        self.assertEqual(result.status_code, 403)
        self.assertEqual(outside.read_text(), '# Original\n')
        self.assertEqual((self.roots['config'] / 'test.md').read_text(), '# Original\n')

    def test_upload_binary_unicode_nested_and_conflict(self):
        folder = self.roots['config'] / '자료'
        folder.mkdir()
        self.assertEqual(self.upload(name='사진.png', directory='자료').status_code, 201)
        self.assertEqual((folder / '사진.png').read_bytes(), b'\x00image')
        self.assertEqual(self.upload(name='사진.png', directory='자료', content=b'new').status_code, 409)
        self.assertEqual((folder / '사진.png').read_bytes(), b'\x00image')
        self.assertEqual(self.upload(name='test.md', content=b'new').status_code, 409)

    def test_upload_filename_and_payload_validation(self):
        for name in ('../outside', '/tmp/outside', 'a/b', '.codemirror-temp', 'test.md.backup'):
            with self.subTest(name=name):
                self.assertEqual(self.upload(name=name).status_code, 400)
        self.assertEqual(self.client.post('/api/upload', headers=self.headers).status_code, 400)
        self.assertEqual(self.client.put('/api/files/test.md', json={'content': 42},
                                        headers=self.headers).status_code, 400)

    def test_upload_rejects_unparsed_backslash_name(self):
        from werkzeug.datastructures import FileStorage
        from werkzeug.exceptions import BadRequest
        storage = FileStorage(stream=io.BytesIO(b'x'), filename='a\\b')
        with self.assertRaises(BadRequest):
            server.filesystem.upload(self.roots['config'], '', storage, 1024)

    def test_upload_limit_leaves_no_partial_file(self):
        self.options.write_text(json.dumps({'max_upload_mb': 1}))
        result = self.upload(content=b'x' * (1024 * 1024 + 1))
        self.assertEqual(result.status_code, 413)
        self.assertFalse((self.roots['config'] / 'image.png').exists())
        self.assertFalse(list(self.roots['config'].glob('.codemirror-*')))

    def test_ingress_and_csrf_boundaries(self):
        self.assertEqual(self.client.post('/api/upload').status_code, 403)
        with patch.object(server, 'TOKEN', 'test-only-token'):
            self.assertEqual(self.client.get('/api/files').status_code, 403)
            self.assertEqual(self.client.get('/api/files',
                environ_base={'REMOTE_ADDR': '172.30.32.2'}).status_code, 200)
            self.assertEqual(self.client.get('/health').status_code, 200)
        with patch.dict(os.environ, {'CODEMIRROR_INGRESS_ONLY': '1'}):
            self.assertEqual(self.client.get('/api/files').status_code, 403)

    def test_home_assistant_entity_and_validation_contracts(self):
        entities = Mock()
        entities.json.return_value = [{'entity_id': 'light.kitchen', 'state': 'on',
                                       'attributes': {'friendly_name': 'Kitchen'}}]
        validation = Mock()
        validation.json.return_value = {'result': 'valid', 'errors': None}
        with patch.object(server, 'TOKEN', 'test-only-token'), \
             patch.object(server.requests, 'get', return_value=entities), \
             patch.object(server.requests, 'post', return_value=validation) as post:
            ingress = {'REMOTE_ADDR': '172.30.32.2'}
            result = self.client.get('/api/entities', environ_base=ingress)
            self.assertEqual(result.json[0]['entity_id'], 'light.kitchen')
            result = self.client.post('/api/validate', headers=self.headers,
                                      json={}, environ_base=ingress)
            self.assertEqual(result.json['result'], 'valid')
            self.assertTrue(post.call_args.args[0].endswith('/config/core/check_config'))

    def test_invalid_text_and_oversized_editor_files(self):
        (self.roots['config'] / 'binary.md').write_bytes(b'\xff\x00')
        self.assertEqual(self.client.get('/api/files/binary.md').status_code, 400)
        result = self.client.put('/api/files/test.md', json={'content': '\ud800'}, headers=self.headers)
        self.assertEqual(result.status_code, 400)
        (self.roots['config'] / 'large.md').write_bytes(b'x' * (4 * 1024 * 1024 + 1))
        self.assertEqual(self.client.get('/api/files/large.md').status_code, 413)

    def test_hardlinks_and_special_files_are_not_editable(self):
        root = self.roots['config']
        os.link(self.roots['ssl'] / 'test.md', root / 'hard.md')
        os.mkfifo(root / 'pipe.md')
        for name in ('hard.md', 'pipe.md'):
            self.assertEqual(self.client.get(f'/api/files/{name}').status_code, 403)

    def test_unknown_api_is_json_404(self):
        result = self.client.get('/api/unknown')
        self.assertEqual(result.status_code, 404)
        self.assertIsNotNone(result.json)

    def create(self, name, kind='file', directory='', root='config'):
        return self.client.post(f'/api/entries?root={root}', headers=self.headers,
                                json={'name': name, 'type': kind, 'directory': directory})

    def test_create_files_and_directories_without_overwriting(self):
        self.assertEqual(self.create('새 폴더', 'directory').status_code, 201)
        result = self.create('new.yaml', directory='새 폴더')
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json['path'], '새 폴더/new.yaml')
        self.assertEqual((self.roots['config'] / '새 폴더/new.yaml').read_text(), '')
        self.assertEqual(self.create('new.json').status_code, 201)
        self.assertEqual(json.loads((self.roots['config'] / 'new.json').read_text()), {})
        self.assertEqual(self.create('test.md').status_code, 409)
        self.assertEqual(self.create('새 폴더', 'directory').status_code, 409)
        self.assertEqual((self.roots['config'] / 'test.md').read_text(), '# Original\n')

    def test_creation_enforces_opt_in_and_path_boundaries(self):
        for root in self.roots:
            if root == 'config':
                continue
            for kind in ('file', 'directory'):
                self.assertEqual(self.create('new.yaml', kind, root=root).status_code, 403)
            self.opt_in(root)
            self.assertEqual(self.create('new.yaml', root=root).status_code, 201)
            self.opt_in()
        (self.roots['config'] / 'escape').symlink_to(self.roots['ssl'])
        self.assertEqual(self.create('new.md', directory='escape').status_code, 403)
        self.assertEqual(self.create('new.md', directory='../ssl').status_code, 403)
        self.assertEqual(self.create('new.md', directory='missing').status_code, 404)
        for name in ('', '.', '..', '../x.md', '/x.md', 'x/y.md', 'a\\b', '.codemirror-x', 'x.backup'):
            self.assertEqual(self.create(name).status_code, 400)
        self.assertEqual(self.create('x.png').status_code, 400)
        self.assertEqual(self.create('test.md', kind='link').status_code, 400)
        self.assertEqual(self.create(None).status_code, 400)
        self.assertEqual(self.client.post('/api/entries', headers=self.headers, json=[]).status_code, 400)
        self.assertEqual(self.client.post('/api/entries', json={}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
