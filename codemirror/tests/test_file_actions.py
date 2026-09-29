import errno
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server
import file_actions


class ExplorerAPITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'config'
        self.media = self.base / 'media'
        self.root.mkdir(); self.media.mkdir()
        (self.root / 'folder').mkdir()
        (self.root / 'folder' / 'a.txt').write_text('source')
        self.options = self.base / 'options.json'
        self.options.write_text('{}')
        patches = patch.multiple(server, ROOT_PATHS={'config': self.root, 'media': self.media}, OPTIONS_FILE=self.options)
        patches.start(); self.addCleanup(patches.stop)
        self.client = server.app.test_client()

    def action(self, action, path, destination=None, root='config', destination_root='config'):
        return self.client.post('/api/entries/action?root=' + root,
            json=dict(action=action, path=path, destination=destination, destination_root=destination_root),
            headers={'X-CodeMirror-Request': '1'})

    def test_recursive_copy_rename_delete(self):
        self.assertEqual(self.action('copy', 'folder', 'copy').status_code, 200)
        self.assertEqual((self.root / 'copy/a.txt').read_text(), 'source')
        self.assertEqual(self.action('move', 'copy', '이름 변경').status_code, 200)
        self.assertFalse((self.root / 'copy').exists())
        self.assertEqual(self.action('delete', '이름 변경').status_code, 200)
        self.assertFalse((self.root / '이름 변경').exists())
        self.assertTrue((self.root / 'folder/a.txt').exists())

    def test_conflicts_never_overwrite(self):
        (self.root / 'existing').mkdir()
        for action in ('copy', 'move'):
            self.assertEqual(self.action(action, 'folder', 'existing').status_code, 409)
            self.assertEqual((self.root / 'folder/a.txt').read_text(), 'source')
        self.assertEqual(list(self.root.glob('.codemirror-*')), [])

    def test_roots_traversal_descendants_and_links_rejected(self):
        for action, path, destination in [('delete', '', None), ('move', 'folder', 'folder/nested'),
                ('copy', 'folder', '../outside'), ('delete', '../outside', None)]:
            self.assertIn(self.action(action, path, destination).status_code, (400, 403))
        (self.root / 'folder/link').symlink_to(self.media, target_is_directory=True)
        for action in ('copy', 'move', 'delete'):
            self.assertEqual(self.action(action, 'folder', 'target').status_code, 403)
        self.assertTrue((self.root / 'folder/a.txt').exists())

    def test_both_roots_require_permission(self):
        self.assertEqual(self.action('copy', 'folder', 'target', destination_root='media').status_code, 403)
        self.options.write_text(json.dumps({'allow_media': True}))
        self.assertEqual(self.action('move', 'folder', 'target', destination_root='media').status_code, 200)
        self.assertEqual((self.media / 'target/a.txt').read_text(), 'source')
        self.assertFalse((self.root / 'folder').exists())
        self.options.write_text('{}')
        self.assertEqual(self.action('copy', 'target', 'target', root='media').status_code, 403)

    def test_cross_device_move_and_copy_failure_preserves_source(self):
        original = file_actions.rename_exclusive
        def rename(source_fd, source, target_fd, target):
            if source == 'folder':
                raise OSError(errno.EXDEV, 'Cross device')
            return original(source_fd, source, target_fd, target)
        with patch.object(file_actions, 'rename_exclusive', side_effect=rename):
            self.assertEqual(self.action('move', 'folder', 'moved').status_code, 200)
        self.assertFalse((self.root / 'folder').exists())
        self.assertEqual((self.root / 'moved/a.txt').read_text(), 'source')
        with patch.object(file_actions, 'copy_entry', side_effect=PermissionError()):
            self.assertNotEqual(self.action('copy', 'moved', 'failed').status_code, 200)
        self.assertTrue((self.root / 'moved/a.txt').exists())
        self.assertFalse((self.root / 'failed').exists())
        self.assertEqual(list(self.root.glob('.codemirror-*')), [])
