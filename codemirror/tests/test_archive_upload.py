import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server


class ArchiveUploadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.config = self.base / 'config'; self.config.mkdir()
        self.media = self.base / 'media'; self.media.mkdir()
        self.options = self.base / 'options.json'; self.options.write_text('{"max_upload_mb":1}')
        patched = patch.multiple(server, ROOT_PATHS={'config': self.config, 'media': self.media}, OPTIONS_FILE=self.options)
        patched.start(); self.addCleanup(patched.stop)
        self.client = server.app.test_client()

    def archive(self, entries):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path, data in entries:
                archive.writestr(path, data)
        return stream.getvalue()

    def upload(self, data, root='config', folder=''):
        return self.client.post('/api/upload-folder?root=' + root, headers={'X-CodeMirror-Request': '1'},
            data={'directory': folder, 'file': (io.BytesIO(data), 'folder.zip')})

    def test_nested_binary_unicode_empty_folders_and_conflict(self):
        archive = self.archive([('폴더/nested/data.bin', b'\0\xff'), ('폴더/readme.md', '# hello'), ('폴더/empty/', '')])
        result = self.upload(archive)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual((self.config / '폴더/nested/data.bin').read_bytes(), b'\0\xff')
        self.assertTrue((self.config / '폴더/empty').is_dir())
        self.assertEqual(self.upload(archive).status_code, 409)
        self.assertEqual(list(self.config.glob('.codemirror-*')), [])

    def test_permission_and_destination_links(self):
        data = self.archive([('folder/a.txt', 'data')])
        self.assertEqual(self.upload(data, root='media').status_code, 403)
        self.options.write_text(json.dumps({'allow_media': True}))
        self.assertEqual(self.upload(data, root='media').status_code, 201)
        (self.config / 'link').symlink_to(self.media, target_is_directory=True)
        self.assertEqual(self.upload(data, folder='link').status_code, 403)

    def test_unsafe_paths_duplicates_and_multiple_roots(self):
        cases = [[('../escape', 'x')], [('/absolute/a.txt', 'x')], [('folder/../escape', 'x')],
                 [('folder\\escape', 'x')], [('C:/escape', 'x')], [('a.txt', 'x')],
                 [('one/a.txt', 'x'), ('two/a.txt', 'x')], [('folder/a', 'x'), ('folder/a/b', 'x')],
                 [('folder/a', 'x'), ('folder/a', 'y')], [('folder/.codemirror-secret', 'x')]]
        for entries in cases:
            with self.subTest(entries=entries):
                self.assertIn(self.upload(self.archive(entries)).status_code, (400, 403))
                self.assertEqual(list(self.config.iterdir()), [])

    def test_zip_bomb_and_symlinks_rejected_without_partial_publish(self):
        self.assertEqual(self.upload(self.archive([('folder/big.txt', 'x' * (1024 * 1024 + 1))])).status_code, 413)
        link = zipfile.ZipInfo('folder/link'); link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.assertEqual(self.upload(self.archive([(link, '/etc/passwd')])).status_code, 400)
        self.assertEqual(self.upload(b'not a zip').status_code, 400)
        self.assertEqual(list(self.config.iterdir()), [])

    def test_bad_crc_and_excessive_destination_depth_leave_no_partial_folder(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_STORED) as archive:
            archive.writestr('folder/data.txt', 'CRC-CONTENT')
        broken = bytearray(stream.getvalue())
        broken[broken.index(b'CRC-CONTENT')] ^= 1
        self.assertEqual(self.upload(bytes(broken)).status_code, 400)
        deep = '/'.join(['level'] * 31)
        self.assertEqual(self.upload(self.archive([('folder/data.txt', 'x')]), folder=deep).status_code, 400)
        self.assertEqual(list(self.config.iterdir()), [])
