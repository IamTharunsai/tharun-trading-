import io
import json
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gateway


class InputBoundary(unittest.TestCase):
    def test_overrides_rejected(self):
        for field in ('model', 'base_url', 'tools', 'commands', 'project_path', 'conversation_history'):
            with self.assertRaises(gateway.Refusal):
                gateway.validate_input({'question': 'q', 'evidence': '', field: 'x'})

    def test_nontext_and_oversized_evidence_rejected(self):
        for evidence in (None, {}, [], 'x'*16001):
            with self.assertRaises(gateway.Refusal):
                gateway.validate_input({'question': 'q', 'evidence': evidence})

    def test_empty_and_oversized_question_rejected(self):
        for question in (' ', 'x'*1001, 1):
            with self.assertRaises(gateway.Refusal):
                gateway.validate_input({'question': question, 'evidence': ''})

    def test_utf8_budget_matches_worker_without_ascii_escape_inflation(self):
        accepted = {'question': 'q', 'evidence': '中'*9000}
        self.assertEqual(gateway.validate_input(accepted), accepted)
        for value in ('中'*16000, '\ud800'):
            with self.assertRaises(gateway.Refusal):
                gateway.validate_input({'question': 'q', 'evidence': value})

    def test_missing_auth_fails_startup(self):
        with patch.object(gateway, 'KEY', ''), self.assertRaises(SystemExit):
            gateway.main()

    def test_missing_scenario_adapter_blocks_even_with_keys(self):
        with patch.object(gateway, 'SERVICE', 'mirofish'), patch.dict(gateway.os.environ,
                {'NVIDIA_API_KEY': 'fixture-only', 'ZEP_API_KEY': 'fixture-only'}), patch.object(Path, 'is_file', return_value=False):
            state = gateway.readiness()
            self.assertFalse(state['ready'])
            self.assertIn('bounded_scenario_adapter', state['blockedBy'])
            self.assertFalse(state['tradingAuthority'])

    def test_hermes_never_accepts_tools_or_tool_messages(self):
        with patch.object(gateway, 'SERVICE', 'hermes'):
            for messages, tools in (([{'role': 'tool', 'content': 'x'}], None),
                                    ([{'role': 'assistant', 'content': 'x'}], [{'type': 'function'}])):
                with self.assertRaises(gateway.Refusal):
                    gateway.validate_model_messages(messages, tools)

    def test_mirofish_accepts_only_local_social_simulation_actions(self):
        with patch.object(gateway, 'SERVICE', 'mirofish'):
            valid = [{'type': 'function', 'function': {'name': 'create_post', 'parameters': {'type': 'object'}}}]
            gateway.validate_model_messages([{'role': 'user', 'content': 'fixture'}], valid)
            for tool in ('shell', 'place_order', 'transfer', 'browse', 'send_email'):
                with self.assertRaises(gateway.Refusal):
                    gateway.validate_model_messages([{'role': 'user', 'content': 'fixture'}],
                        [{'type': 'function', 'function': {'name': tool, 'parameters': {'type': 'object'}}}])

    def test_cloud_claim_retention_rejects_symlinks_and_invalid_ids(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(gateway, 'STATE', Path(folder)):
            home = Path(folder) / 'job'
            home.mkdir()
            manifest = home / 'mirofish-ownership.json'
            manifest.write_text(json.dumps({'sourceCommit': gateway.PINS['mirofish']['commit'],
                'projectId': '../other-owner', 'graphId': 'graph', 'status': 'completed'}))
            with self.assertRaises(gateway.Refusal):
                gateway.retain_mirofish_ownership(home)
            manifest.write_text(json.dumps({'sourceCommit': gateway.PINS['mirofish']['commit'],
                'projectId': 'fixture-owned-claim', 'graphId': 'fixture-graph', 'status': 'completed'}))
            gateway.retain_mirofish_ownership(home)
            with gateway.sqlite3.connect(Path(folder) / 'quota.sqlite') as db:
                self.assertEqual(db.execute('SELECT graph_id,status FROM cloud_claims').fetchone(), ('fixture-graph', 'completed'))

    def test_quota_persists_and_does_not_overspend(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(gateway, 'STATE', Path(folder)):
            for _ in range(16):
                gateway.take_daily_quota()
            with self.assertRaises(gateway.Refusal) as failure:
                gateway.take_daily_quota()
            self.assertEqual(failure.exception.status, 429)
            with gateway.sqlite3.connect(Path(folder) / 'quota.sqlite') as db:
                self.assertEqual(db.execute('SELECT count FROM quota').fetchone()[0], 16)


class HttpBoundary(unittest.TestCase):
    def setUp(self):
        self.key = 'fixture-only-' + 'a'*32
        self.auth_patch = patch.object(gateway.Handler, 'authenticated',
            lambda handler, key=None: handler.headers.get('Authorization') == 'Bearer ' + self.key)
        self.auth_patch.start()
        self.service_patch = patch.object(gateway, 'SERVICE', 'mirofish')
        self.service_patch.start()
        self.server = gateway.BoundedServer(('127.0.0.1', 0), gateway.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_address[1])

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.auth_patch.stop()
        self.service_patch.stop()

    def request(self, path, body=None, auth=True):
        request = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer '+self.key} if auth else {})})
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as failure:
            return failure.code, json.load(failure)

    def test_auth_required_for_status_and_jobs(self):
        self.assertEqual(self.request('/v1/status', auth=False)[0], 401)
        self.assertEqual(self.request('/v1/research', {'question': 'q', 'evidence': ''}, auth=False)[0], 401)

    def test_liveness_is_distinct_from_readiness(self):
        self.assertEqual(self.request('/health', auth=False), (200, {'status': 'running', 'service': 'mirofish'}))
        status, body = self.request('/v1/ready')
        self.assertEqual(status, 503)
        self.assertFalse(body['ready'])

    def test_arbitrary_proxy_route_rejected(self):
        self.assertEqual(self.request('/api/simulation/start', {'simulation_id': '../../other'})[0], 404)

    def test_unready_research_never_runs_worker(self):
        with patch.object(gateway, 'run_worker') as worker:
            self.assertEqual(self.request('/v1/research', {'question': 'q', 'evidence': ''})[0], 503)
            worker.assert_not_called()

    def test_absolute_header_deadline_closes_slow_peer(self):
        with patch.object(gateway, 'INPUT_DEADLINE_SECONDS', 0.15):
            connection = socket.create_connection(self.server.server_address, timeout=1)
            connection.sendall(b'GET /health HTTP/1.1\r\nHost: fixture\r\nX-Slow: ')
            time.sleep(0.3)
            self.assertEqual(connection.recv(1), b'')
            connection.close()
        self.assertEqual(self.request('/health', auth=False)[0], 200)

    def test_absolute_body_deadline_closes_authenticated_slow_peer(self):
        with patch.object(gateway, 'INPUT_DEADLINE_SECONDS', 0.15):
            connection = socket.create_connection(self.server.server_address, timeout=1)
            headers = ('POST /v1/research HTTP/1.1\r\nHost: fixture\r\nAuthorization: Bearer '+self.key+
                       '\r\nContent-Type: application/json\r\nContent-Length: 50\r\n\r\n{')
            connection.sendall(headers.encode())
            time.sleep(0.3)
            self.assertEqual(connection.recv(1), b'')
            connection.close()
        self.assertEqual(self.request('/health', auth=False)[0], 200)


if __name__ == '__main__':
    unittest.main()
