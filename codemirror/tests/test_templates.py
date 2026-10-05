"""Template evaluation uses HA's live context, never a local Jinja environment."""
from unittest.mock import patch
import unittest

from test_ha_controls import response, server


class TemplateTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        token = patch.object(server, 'TOKEN', 'test-supervisor-token')
        token.start()
        self.addCleanup(token.stop)
        self.headers = {'X-CodeMirror-Request': '1'}
        self.ingress = {'REMOTE_ADDR': '172.30.32.2'}

    def render(self, body):
        return self.client.post('/api/template', json=body, headers=self.headers,
                                environ_base=self.ingress)

    def test_plain_text_is_preserved(self):
        for content in ('on', '001', 'false', '', '<script>alert(1)</script>\n한글'):
            upstream = response(None)
            upstream.text = content
            with patch.object(server.requests, 'post', return_value=upstream) as post:
                result = self.render({'template': "{{ states('light.kitchen') }}"})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json, {'result': content})
                self.assertEqual(post.call_args.args[0], 'http://supervisor/core/api/template')
                self.assertEqual(post.call_args.kwargs['json'], {'template': "{{ states('light.kitchen') }}"})
                self.assertEqual(post.call_args.kwargs['timeout'], (5, 10))

    def test_invalid_input_never_reaches_ha(self):
        with patch.object(server.requests, 'post') as post:
            for body in ([], {}, {'template': None}, {'template': 2}, {'template': '  '},
                         {'template': 'x' * 65537}, {'template': '한' * 22000}, {'template': '\ud800'}):
                self.assertEqual(self.render(body).status_code, 400)
            post.assert_not_called()

    def test_busy_and_error_release(self):
        with server.template_lock, patch.object(server.requests, 'post') as post:
            self.assertEqual(self.render({'template': '{{ 1 }}'}).status_code, 409)
            post.assert_not_called()
        with patch.object(server.requests, 'post', side_effect=server.requests.Timeout()):
            self.assertEqual(self.render({'template': '{{ 1 }}'}).status_code, 504)
        self.assertFalse(server.template_lock.locked())

    def test_template_error_and_connection_failures(self):
        bad = response({'message': "UndefinedError: 'trigger' is undefined"}, 400)
        for upstream, status, message in (
            (bad, 400, 'trigger'), (response({}, 401), 403, 'access denied'),
            (server.requests.Timeout(), 504, 'timed out'),
            (server.requests.ConnectionError(), 502, 'connect'),
        ):
            with patch.object(server.requests, 'post', side_effect=[upstream]):
                result = self.render({'template': '{{ trigger }}'})
                self.assertEqual(result.status_code, status)
                self.assertIn(message, result.json['error'])
                self.assertNotIn('test-supervisor-token', result.get_data(as_text=True))

    def test_ingress_header_and_missing_token(self):
        with patch.object(server.requests, 'post') as post:
            self.assertEqual(self.client.post('/api/template', json={'template': '{{ 1 }}'},
                                             headers=self.headers).status_code, 403)
            self.assertEqual(self.client.post('/api/template', json={'template': '{{ 1 }}'},
                                             environ_base=self.ingress).status_code, 403)
            with patch.object(server, 'TOKEN', ''):
                self.assertEqual(self.render({'template': '{{ 1 }}'}).status_code, 503)
            post.assert_not_called()
