import sys
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server


def response(body, status=200):
    result = Mock(status_code=status)
    result.json.return_value = body
    if status >= 400:
        result.raise_for_status.side_effect = server.requests.HTTPError(response=result)
    return result


class HAControlTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.token = patch.object(server, 'TOKEN', 'test-supervisor-token')
        self.token.start()
        self.addCleanup(self.token.stop)
        self.headers = {'X-CodeMirror-Request': '1'}
        self.ingress = {'REMOTE_ADDR': '172.30.32.2'}

    def action(self, action):
        return self.client.post(f'/api/ha/{action}', json={}, headers=self.headers,
                                environ_base=self.ingress)

    def test_restart_validates_then_uses_supervisor(self):
        with patch.object(server.requests, 'post', side_effect=[
            response({'result': 'valid', 'errors': None}), response({'result': 'ok', 'data': {}})
        ]) as post:
            result = self.action('restart')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json['success'], True)
            self.assertEqual(post.call_args_list[0].args[0], 'http://supervisor/core/api/config/core/check_config')
            self.assertEqual(post.call_args_list[1].args[0], 'http://supervisor/core/restart')
            self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer test-supervisor-token')

    def test_reload_uses_fixed_reload_all_service(self):
        with patch.object(server.requests, 'post', side_effect=[
            response({'result': 'valid', 'errors': None}), response([])
        ]) as post:
            self.assertEqual(self.action('reload').status_code, 200)
            self.assertEqual(post.call_args.args[0], 'http://supervisor/core/api/services/homeassistant/reload_all')

    def test_invalid_or_unavailable_config_never_triggers_action(self):
        for validation in ({'result': 'invalid', 'errors': 'bad config'}, {'result': 'unknown'}, []):
            with patch.object(server.requests, 'post', return_value=response(validation)) as post:
                self.assertNotEqual(self.action('restart').status_code, 200)
                self.assertEqual(post.call_count, 1)

    def test_missing_token_and_arbitrary_actions_are_rejected(self):
        with patch.object(server.requests, 'post') as post:
            with patch.object(server, 'TOKEN', ''):
                self.assertEqual(self.action('restart').status_code, 503)
            self.assertEqual(self.action('stop').status_code, 404)
            post.assert_not_called()
        self.assertEqual(self.client.post('/api/ha/restart', environ_base=self.ingress).status_code, 403)

    def test_upstream_permission_error_and_timeout_do_not_retry(self):
        for outcome, expected in ((response({}, 403), 403), (server.requests.Timeout(), 504),
                                  (response({'result': 'error', 'message': 'failed'}), 502)):
            with patch.object(server.requests, 'post', side_effect=[response({'result': 'valid'}), outcome]) as post:
                result = self.action('restart')
                self.assertEqual(result.status_code, expected)
                self.assertEqual(post.call_count, 2)
                self.assertNotIn('test-supervisor-token', result.get_data(as_text=True))

    def test_busy_action_rejected_before_upstream_request(self):
        with server.ha_control_lock, patch.object(server.requests, 'post') as post:
            self.assertEqual(self.action('reload').status_code, 409)
            post.assert_not_called()

    def test_entity_errors_are_not_reported_as_successful_empty_list(self):
        with patch.object(server.requests, 'get', return_value=response({}, 401)):
            self.assertEqual(self.client.get('/api/entities', environ_base=self.ingress).status_code, 403)
        with patch.object(server.requests, 'get', return_value=response({'not': 'states'})):
            self.assertEqual(self.client.get('/api/entities', environ_base=self.ingress).status_code, 502)
        with patch.object(server.requests, 'get', return_value=response([])):
            self.assertEqual(self.client.get('/api/entities', environ_base=self.ingress).json, [])

    def test_translated_state_comes_from_fixed_ha_template(self):
        states = [{'entity_id': 'light.kitchen', 'state': 'on', 'attributes': {'friendly_name': '주방'}}]
        with patch.object(server.requests, 'get', return_value=response(states)), patch.object(server.requests, 'post', return_value=response({'light.kitchen': '켜짐'})) as post:
            result = self.client.get('/api/entities', environ_base=self.ingress)
            self.assertEqual(result.json[0]['state_translated'], '켜짐')
            self.assertEqual(result.json[0]['state'], 'on')
            self.assertEqual(post.call_args.args[0], 'http://supervisor/core/api/template')
            self.assertIn('state_translated(s.entity_id)', post.call_args.kwargs['json']['template'])
        with patch.object(server.requests, 'get', return_value=response(states)), patch.object(server.requests, 'post', side_effect=server.requests.Timeout()):
            result = self.client.get('/api/entities', environ_base=self.ingress)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json[0]['state'], 'on')
            self.assertNotIn('state_translated', result.json[0])
