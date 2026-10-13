"""Authenticated research boundary. No broker, database, shell or order capabilities."""
import hashlib
import hmac
import json
import os
import select
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PINS = json.loads((ROOT / "pins.json").read_text())
SERVICE = os.environ.get("RESEARCH_SERVICE", "")
KEY = os.environ.get("RESEARCH_SERVICE_KEY", "").strip()
MODEL = os.environ.get("RESEARCH_MODEL", "nvidia/nemotron-3-super-120b-a12b")
MAX_BODY = 32768
MAX_RESPONSE = 262144
JOB_LOCK = threading.Lock()
PROXY_LOCK = threading.Lock()
PROXY_KEY = os.urandom(32).hex()
PROXY_CALLS = 0
PROXY_ACTIVE = False
PROVIDER_PROCESSES = set()
INPUT_DEADLINE_SECONDS = 10
STATE = Path(os.environ.get("RESEARCH_STATE", "/data"))


class Refusal(Exception):
    def __init__(self, code, status=422, diagnostic=None, exception_kind=None):
        self.code, self.status, self.diagnostic = code, status, diagnostic
        self.exception_kind = exception_kind if exception_kind in (
            'AttributeError', 'TypeError', 'ModuleNotFoundError', 'ImportError',
            'RuntimeError', 'PermissionError', 'ValueError') else None


def read_json(handler, maximum=MAX_BODY):
    if handler.headers.get("Transfer-Encoding"):
        raise Refusal("transfer_encoding_not_supported", 400)
    if handler.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
        raise Refusal("json_required", 415)
    try:
        size = int(handler.headers.get("Content-Length", "-1"))
    except ValueError:
        raise Refusal("invalid_length", 400)
    if not 0 < size <= maximum:
        raise Refusal("body_too_large_or_missing", 413)
    raw = handler.rfile.read(size)
    if len(raw) != size:
        raise Refusal("incomplete_body", 400)
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        raise Refusal("invalid_json", 400)
    if not isinstance(value, dict):
        raise Refusal("object_required", 400)
    return value


def validate_input(body):
    if set(body) != {"question", "evidence"}:
        raise Refusal("only_question_and_evidence_allowed")
    if not isinstance(body["question"], str) or not 1 <= len(body["question"].strip()) <= 1000:
        raise Refusal("invalid_question")
    if not isinstance(body["evidence"], str) or len(body["evidence"]) > 16000:
        raise Refusal("invalid_evidence")
    try:
        encoded = json.dumps(body, ensure_ascii=False).encode('utf-8')
    except UnicodeError:
        raise Refusal('invalid_unicode')
    if len(encoded) > MAX_BODY:
        raise Refusal('input_byte_limit')
    return body


def take_daily_quota():
    # Reserve before execution, including failed calls. Survives service restarts.
    day = time.strftime("%Y-%m-%d", time.gmtime())
    with sqlite3.connect(STATE / "quota.sqlite", timeout=3) as db:
        db.execute("CREATE TABLE IF NOT EXISTS quota(day TEXT PRIMARY KEY, count INTEGER NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT count FROM quota WHERE day=?", (day,)).fetchone()
        if row and row[0] >= 16:
            raise Refusal("daily_research_budget_exhausted", 429)
        db.execute("INSERT INTO quota VALUES (?,1) ON CONFLICT(day) DO UPDATE SET count=count+1", (day,))
        db.execute("DELETE FROM quota WHERE day<?", (time.strftime("%Y-%m-%d", time.gmtime(time.time()-7*86400)),))


def graph_metadata():
    path = Path("/graph/graph.json")
    if path.stat().st_size > 33554432:
        raise ValueError("graph_size")
    data = json.loads(path.read_text())
    nodes = data.get("nodes", [])
    edges = data.get("edges", data.get("links", []))
    if data.get("built_at_commit") != PINS["corpus"]["commit"] or not nodes or not edges:
        raise ValueError("graph_provenance")
    return {"nodes": len(nodes), "edges": len(edges), "corpusCommit": data["built_at_commit"],
            "artifactSha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def readiness():
    missing = []
    if SERVICE in ("hermes", "mirofish") and not os.environ.get("NVIDIA_API_KEY", "").strip():
        missing.append("NVIDIA_API_KEY")
    if SERVICE == "mirofish" and not os.environ.get("ZEP_API_KEY", "").strip():
        missing.append("ZEP_API_KEY")
    extra = {}
    if SERVICE == "graphify":
        try:
            extra = graph_metadata()
        except (OSError, ValueError, TypeError):
            missing.append("verified_code_graph")
    if SERVICE == "mirofish" and not (ROOT / "mirofish_worker.py").is_file():
        missing.append("bounded_scenario_adapter")
    return {"service": SERVICE, "sourceCommit": PINS[SERVICE]["commit"], "ready": not missing,
            **({'model': MODEL} if SERVICE in ('hermes', 'mirofish') else {}),
            "blockedBy": missing, "capabilities": ["code_graph_query"] if SERVICE == "graphify" else
            (["evidence_research_without_tools"] if SERVICE == "hermes" else ["bounded_scenario_simulation"]),
            "tradingAuthority": False, **extra}


def run_worker(body):
    global PROXY_CALLS, PROXY_ACTIVE, PROXY_KEY
    with tempfile.TemporaryDirectory(prefix="job-", dir=STATE) as home:
        with PROXY_LOCK:
            PROXY_KEY = os.urandom(32).hex()
            PROXY_CALLS, PROXY_ACTIVE = 0, SERVICE in ("hermes", "mirofish")
        interpreter = "/engine/backend/.venv/bin/python" if SERVICE == "mirofish" else "/engine/.venv/bin/python"
        env = {"PATH": str(Path(interpreter).parent) + ":/usr/local/bin:/usr/bin:/bin", "HOME": home,
               "TMPDIR": home, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": "/engine",
               "HERMES_HOME": home, "HERMES_SAFE_MODE": "1", "HERMES_API_TIMEOUT": "35",
               "RESEARCH_MODEL": MODEL, "PROXY_KEY": PROXY_KEY,
               "OPENAI_API_KEY": PROXY_KEY, "OPENAI_BASE_URL": "http://127.0.0.1:8081/v1",
               "OPENAI_API_BASE_URL": "http://127.0.0.1:8081/v1",
               "GRAPHIFY_MAX_GRAPH_BYTES": "33554432", "GRAPHIFY_QUERY_LOG_DISABLE": "1"}
        if SERVICE == "mirofish":
            env["ZEP_API_KEY"] = os.environ["ZEP_API_KEY"]
            env["MIROFISH_LOG_DIR"] = str(Path(home) / "logs")
        worker = {"hermes": "hermes_worker.py", "graphify": "graph_worker.py", "mirofish": "mirofish_worker.py"}[SERVICE]
        with tempfile.TemporaryFile(dir=home) as output:
            process = subprocess.Popen([interpreter, str(ROOT / worker)],
                                       stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL,
                                       cwd="/engine", env=env, start_new_session=True)
            try:
                process.communicate(json.dumps(body, ensure_ascii=False).encode('utf-8'), timeout={"hermes": 75, "graphify": 30, "mirofish": 480}[SERVICE])
                if process.returncode != 0:
                    raise Refusal("research_worker_failed", 502)
                if output.tell() > MAX_RESPONSE:
                    raise Refusal("research_output_limit", 502)
                output.seek(0)
                result = json.loads(output.read(MAX_RESPONSE+1))
                diagnostic = result.get("diagnostic") if isinstance(result, dict) else None
                if isinstance(diagnostic, str) and diagnostic in {'mirofish_' + phase + '_failed' for phase in
                        ('config', 'import', 'ontology', 'graph', 'preflight', 'prepare', 'simulation', 'report', 'cleanup')}:
                    raise Refusal('research_worker_failed', 502, diagnostic, result.get('exceptionKind'))
                if isinstance(diagnostic, str) and diagnostic in {
                        stage + '_' + kind for stage in ('import', 'init', 'isolation', 'research', 'result')
                        for kind in ('AttributeError', 'TypeError', 'ModuleNotFoundError', 'ImportError', 'RuntimeError', 'PermissionError', 'ValueError')}:
                    raise Refusal("research_worker_failed", 502, diagnostic)
                if not isinstance(result, dict) or not isinstance(result.get("text"), str) or not result['text'].strip() or len(result['text']) > 16000:
                    raise Refusal("research_output_invalid", 502)
                if SERVICE in ('hermes', 'mirofish') and (result.get('completed') is not True or
                        result.get('partial') is True or result.get('failed') or result.get('interrupted')):
                    raise Refusal("research_incomplete", 502)
                return {**result, "service": SERVICE, "sourceCommit": PINS[SERVICE]["commit"],
                        "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "evidenceOnly": True, "tradingAuthority": False,
                        **({'calibratedForecast': False} if SERVICE == 'mirofish' else {})}
            except subprocess.TimeoutExpired:
                raise Refusal("research_deadline_exceeded", 504)
            except (ValueError, UnicodeError):
                raise Refusal("research_output_invalid", 502)
            finally:
                with PROXY_LOCK:
                    PROXY_ACTIVE = False
                    for provider in tuple(PROVIDER_PROCESSES):
                        kill_group(provider)
                # Kill the whole child group even if its leader exited early.
                kill_group(process)
                process.wait(timeout=5)
                if SERVICE == "mirofish":
                    retain_mirofish_ownership(Path(home))
                print(json.dumps({'event': 'research_worker_finished', 'service': SERVICE, 'providerCalls': PROXY_CALLS}), flush=True)


def retain_mirofish_ownership(home):
    """Retain claims for review, never automatically delete a graph on this evidence."""
    import re
    try:
        descriptor = os.open(home / "mirofish-ownership.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        import stat
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 4096:
            raise Refusal("ownership_manifest_invalid", 502)
        data = json.loads(source.read(4097))
    if set(data) != {"sourceCommit", "projectId", "graphId", "status"} or data["sourceCommit"] != PINS["mirofish"]["commit"] or data["status"] not in ('running', 'completed', 'failed'):
        raise Refusal("ownership_manifest_invalid", 502)
    if any(value is not None and (not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value)) for value in (data['projectId'], data['graphId'])) or not data['projectId']:
        raise Refusal("ownership_manifest_invalid", 502)
    with sqlite3.connect(STATE / 'quota.sqlite', timeout=3) as db:
        db.execute('CREATE TABLE IF NOT EXISTS cloud_claims(project_id TEXT PRIMARY KEY, graph_id TEXT, status TEXT, source_commit TEXT, recorded_at REAL)')
        db.execute('INSERT INTO cloud_claims VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET graph_id=excluded.graph_id,status=excluded.status,recorded_at=excluded.recorded_at',
                   (data['projectId'], data['graphId'], data['status'], data['sourceCommit'], time.time()))


def kill_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(8)
        # Absolute deadline also bounds continuously dripping headers/body.
        self.input_deadline = threading.Timer(INPUT_DEADLINE_SECONDS, self.close_input)
        self.input_deadline.daemon = True
        self.input_deadline.start()

    def close_input(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def finish(self):
        self.input_deadline.cancel()
        super().finish()

    def log_message(self, *_):
        pass  # Never log request bodies, query strings or authorization.

    def respond(self, status, body):
        data = json.dumps(body, ensure_ascii=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def authenticated(self, key=KEY):
        supplied = self.headers.get("Authorization", "")
        return bool(key) and hmac.compare_digest(supplied.encode(), ("Bearer " + key).encode())

    def do_GET(self):
        self.input_deadline.cancel()
        if self.path == "/health":
            return self.respond(200, {"status": "running", "service": SERVICE})
        if not self.authenticated():
            return self.respond(401, {"error": "unauthorized"})
        if self.path not in ("/v1/status", "/v1/ready"):
            return self.respond(404, {"error": "not_found"})
        status = readiness()
        return self.respond(503 if self.path == "/v1/ready" and not status["ready"] else 200, status)

    def do_POST(self):
        if not self.authenticated():
            return self.respond(401, {"error": "unauthorized"})
        if self.path != "/v1/research":
            return self.respond(404, {"error": "not_found"})
        locked = False
        try:
            body = validate_input(read_json(self))
            self.input_deadline.cancel()
            if not readiness()["ready"]:
                raise Refusal("research_not_ready", 503)
            locked = JOB_LOCK.acquire(blocking=False)
            if not locked:
                raise Refusal("research_busy", 429)
            take_daily_quota()
            return self.respond(200, run_worker(body))
        except Refusal as refusal:
            return self.respond(refusal.status, {"error": refusal.code,
                **({"diagnostic": refusal.diagnostic} if refusal.diagnostic else {}),
                **({"exceptionKind": refusal.exception_kind} if refusal.exception_kind else {})})
        except Exception:
            return self.respond(502, {"error": "research_unavailable"})
        finally:
            if locked:
                JOB_LOCK.release()


SOCIAL_ACTIONS = {'create_post', 'like_post', 'repost', 'follow', 'do_nothing', 'quote_post'}


def validate_model_messages(messages, tools):
    if SERVICE != 'mirofish':
        if tools or any(not isinstance(m, dict) or m.get('role') not in ('system', 'user', 'assistant') or
                not isinstance(m.get('content'), str) or set(m)-{'role', 'content'} for m in messages):
            raise Refusal('tools_or_nontext_not_allowed')
        return
    if tools:
        if not isinstance(tools, list) or len(tools) > 6:
            raise Refusal('simulation_tool_limit')
        for tool in tools:
            function = tool.get('function') if isinstance(tool, dict) else None
            if not isinstance(function, dict) or tool.get('type') != 'function' or function.get('name') not in SOCIAL_ACTIONS or set(tool)-{'type', 'function'} or set(function)-{'name', 'description', 'parameters', 'strict'} or not isinstance(function.get('parameters'), dict):
                raise Refusal('simulation_tool_not_allowed')
        if len(json.dumps(tools).encode()) > 16384:
            raise Refusal('simulation_tool_limit')
    for message in messages:
        if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant', 'tool') or set(message)-{'role', 'content', 'tool_calls', 'tool_call_id', 'name'}:
            raise Refusal('simulation_message_not_allowed')
        content = message.get('content')
        calls = message.get('tool_calls')
        if not isinstance(content, str) and not (message['role'] == 'assistant' and content is None and calls):
            raise Refusal('simulation_message_not_allowed')
        if message.get('name') and message['name'] not in SOCIAL_ACTIONS:
            raise Refusal('simulation_tool_not_allowed')
        if message['role'] == 'tool':
            identifier = message.get('tool_call_id')
            if not isinstance(identifier, str) or not 1 <= len(identifier) <= 128:
                raise Refusal('simulation_tool_not_allowed')
        if calls:
            if message['role'] != 'assistant' or not isinstance(calls, list) or len(calls) > 6:
                raise Refusal('simulation_tool_not_allowed')
            for call in calls:
                function = call.get('function') if isinstance(call, dict) else None
                if not isinstance(function, dict) or call.get('type') != 'function' or function.get('name') not in SOCIAL_ACTIONS or not isinstance(function.get('arguments'), str) or len(function['arguments']) > 4096:
                    raise Refusal('simulation_tool_not_allowed')


class ProviderProxy(Handler):
    """Loopback only. The worker receives this token, never the provider credential."""
    def do_GET(self):
        self.input_deadline.cancel()
        self.respond(404, {"error": "not_found"})

    def do_POST(self):
        global PROXY_CALLS
        try:
            if self.path != "/v1/chat/completions" or not self.authenticated(PROXY_KEY):
                path_kind = self.path if self.path in ('/v1/chat/completions', '/chat/completions', '/v1/v1/chat/completions', '/v1/responses', '/responses', '/v1/messages') else 'unsupported_path'
                print(json.dumps({'event': 'provider_request_refused', 'service': SERVICE,
                                  'pathKind': path_kind, 'keyMatches': self.authenticated(PROXY_KEY)}), flush=True)
                raise Refusal("unauthorized", 401)
            body = read_json(self, 65536)
            self.input_deadline.cancel()
            messages = body.get("messages")
            if (SERVICE == 'hermes' and body.get("model") != MODEL) or not isinstance(messages, list) or len(messages) > (32 if SERVICE == 'mirofish' else 12):
                raise Refusal("invalid_provider_request")
            validate_model_messages(messages, body.get('tools'))
            if len(json.dumps(messages, ensure_ascii=False).encode()) > 48000 or body.get("stream"):
                raise Refusal("provider_request_limit")
            # Provider I/O gets its own killable child and absolute deadline.
            payload = {"model": MODEL, "messages": messages, "max_tokens": 1024, "temperature": 0.2}
            if MODEL == 'nvidia/nemotron-3-super-120b-a12b':
                # Official model contract: disable hidden thinking within this small output budget.
                payload.update(temperature=1.0, top_p=0.95,
                    chat_template_kwargs={'enable_thinking': False, 'force_nonempty_content': True})
            if SERVICE == 'mirofish':
                if body.get('tools'):
                    payload['tools'] = body['tools']
                if body.get('response_format') == {'type': 'json_object'}:
                    payload['response_format'] = {'type': 'json_object'}
            with tempfile.TemporaryFile(dir=STATE) as output:
                with PROXY_LOCK:
                    if not PROXY_ACTIVE or not self.authenticated(PROXY_KEY) or PROXY_CALLS >= (32 if SERVICE == 'mirofish' else 2):
                        raise Refusal("provider_call_budget_exhausted", 429)
                    PROXY_CALLS += 1
                    ready_read, ready_write = os.pipe()
                    process = subprocess.Popen([sys.executable, str(ROOT / "provider_worker.py")],
                        stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL,
                        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1",
                             "READY_FD": str(ready_write)}, pass_fds=(ready_write,), start_new_session=True)
                    os.close(ready_write)
                    PROVIDER_PROCESSES.add(process)
                try:
                    # No credential enters this child until it has disabled proc/ptrace access.
                    if not select.select([ready_read], [], [], 2)[0] or os.read(ready_read, 1) != b'R':
                        raise Refusal("provider_isolation_failed", 502)
                    process.communicate(json.dumps({"apiKey": os.environ["NVIDIA_API_KEY"], "request": payload}).encode(), timeout=38)
                    if process.returncode != 0 or output.tell() > MAX_RESPONSE:
                        print(json.dumps({'event': 'provider_process_failed', 'service': SERVICE, 'exitCode': process.returncode}), flush=True)
                        raise Refusal("provider_unavailable", 502)
                    output.seek(0)
                    response = json.loads(output.read(MAX_RESPONSE+1))
                    if isinstance(response, dict) and response.get('providerFailure') in ('tls', 'network', 'invalid_response'):
                        print(json.dumps({'event': 'provider_transport_failed', 'service': SERVICE, 'kind': response['providerFailure']}), flush=True)
                        raise Refusal('provider_unavailable', 502)
                    if isinstance(response, dict) and type(response.get('providerStatus')) is int:
                        code = response['providerStatus']
                        if 100 <= code <= 599:
                            print(json.dumps({'event': 'provider_failure', 'service': SERVICE, 'httpStatus': code}), flush=True)
                        raise Refusal('provider_unavailable', 502)
                finally:
                    os.close(ready_read)
                    kill_group(process)
                    process.wait(timeout=5)
                    with PROXY_LOCK:
                        PROVIDER_PROCESSES.discard(process)
            self.respond(200, response)
        except Refusal as refusal:
            print(json.dumps({'event': 'provider_boundary_refusal', 'service': SERVICE, 'code': refusal.code}), flush=True)
            self.respond(refusal.status, {"error": {"message": refusal.code, "type": "research_boundary"}})
        except Exception as failure:
            kind = type(failure).__name__
            if kind not in ('PermissionError', 'TimeoutExpired', 'FileNotFoundError', 'ValueError', 'BrokenPipeError', 'OSError'):
                kind = 'internal_error'
            print(json.dumps({'event': 'provider_proxy_failed', 'service': SERVICE, 'kind': kind}), flush=True)
            self.respond(502, {"error": {"message": "provider_unavailable", "type": "research_boundary"}})


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def handle_error(self, *_):
        pass  # Disconnects from absolute deadlines must not dump request internals.

    def __init__(self, address, handler):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


def main():
    if SERVICE not in ("graphify", "hermes", "mirofish") or len(KEY) < 32:
        raise SystemExit("Research service or authentication is not configured")
    STATE.mkdir(parents=True, exist_ok=True)
    if SERVICE in ("hermes", "mirofish"):
        proxy = BoundedServer(("127.0.0.1", 8081), ProviderProxy)
        threading.Thread(target=proxy.serve_forever, daemon=True).start()
    BoundedServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
