"""Pure fixture checks only; these do not certify MiroFish/Zep/provider behavior."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("mirofish_worker", Path(__file__).parents[1] / "mirofish_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FixtureApi:
    def __init__(self):
        self.body = {"question": "Could demand decline?", "evidence": "A supplied report describes declining orders."}
        self.calls = []
        self.run_reads = 0
        self.population = 2
        self.completed = True
        self.report = "# Scenario\nUncertain demand; inspect counterevidence."
        self.ownership = []

    def record_ownership(self, *args):
        self.ownership.append(args)

    def read_action_evidence(self, simulation_id):
        return {"totalObservedActions": 2, "actionCounts": {"create_post": 2}, "sample": [{"action": "create_post"}]}

    def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path.endswith("ontology/generate"):
            self.upload = kwargs["data"]
            return {"project_id": "proj_fixture"}
        if path == "/api/graph/build":
            return {"task_id": "graph_task"}
        if path == "/api/graph/task/graph_task":
            return {"status": "completed", "result": {"graph_id": "graph_fixture"}}
        if path == "/api/graph/project/proj_fixture":
            return {"graph_id": "graph_fixture"}
        if path == "/api/simulation/create":
            return {"simulation_id": "sim_fixture"}
        if path == "/api/simulation/prepare":
            return {"task_id": "prepare_task"}
        if path.endswith("prepare/status"):
            return {"status": "ready"}
        if path == "/api/simulation/sim_fixture":
            return {"entities_count": self.population, "profiles_count": self.population,
                    "enable_twitter": True, "enable_reddit": False}
        if path == "/api/simulation/start":
            return {"max_rounds_applied": 2, "graph_memory_update_enabled": False}
        if path.endswith("run-status"):
            self.run_reads += 1
            return {"runner_status": "running" if self.run_reads == 1 else "completed",
                    "twitter_completed": self.completed, "twitter_current_round": 2}
        if path.endswith("close-env"):
            return {"success": True}
        if path == "/api/report/generate":
            return {"report_id": "report_fixture", "task_id": "report_task"}
        if path.endswith("generate/status"):
            return {"status": "completed"}
        if path == "/api/report/report_fixture":
            return {"status": "completed", "markdown_content": self.report}
        raise AssertionError(path)

    def wait(self, read, ready, status_key="status"):
        result = read()
        if not ready(result):
            raise AssertionError("Fixture was not ready")
        return result


class WorkerTests(unittest.TestCase):
    def test_only_question_evidence_and_bounded_utf8(self):
        valid = {"question": "A", "evidence": "B"}
        self.assertEqual(worker.validate_input(valid), valid)
        for invalid in ({**valid, "simulation_id": "someone_else"}, {"question": "A", "evidence": ""},
                        {"question": " ", "evidence": "B"}, {"question": "A", "evidence": "字" * 16000}):
            with self.assertRaises(worker.ScenarioRefused):
                worker.validate_input(invalid)

    def test_entity_cap_checks_actual_selected_list(self):
        for number in (1, 12):
            self.assertEqual(worker.entity_count(types.SimpleNamespace(entities=[None] * number, filtered_count=number)), number)
        for entities, count in (([], 0), ([None] * 13, 13), ([None] * 13, 2), ([None], True)):
            with self.assertRaises(worker.ScenarioRefused):
                worker.entity_count(types.SimpleNamespace(entities=entities, filtered_count=count))

    def test_cap_runs_before_prepare_and_prevents_costly_population(self):
        api = FixtureApi()
        def refuse(graph):
            self.assertEqual(graph, "graph_fixture")
            raise worker.ScenarioRefused("selected_entity_budget_exceeded")
        with self.assertRaises(worker.ScenarioRefused):
            worker.execute_pipeline(api, refuse)
        self.assertFalse(any("prepare" in path for _, path, _ in api.calls))

    def test_actual_pipeline_rounds_single_platform_and_close_before_report(self):
        api = FixtureApi()
        result = worker.execute_pipeline(api, lambda _: 2)
        self.assertTrue(result["completed"])
        self.assertFalse(result["calibratedForecast"])
        calls = {path: kwargs for _, path, kwargs in api.calls}
        self.assertEqual(calls["/api/simulation/create"]["json"], {
            "project_id": "proj_fixture", "enable_twitter": True, "enable_reddit": False})
        self.assertEqual(calls["/api/simulation/prepare"]["json"]["parallel_profile_count"], 1)
        self.assertEqual(calls["/api/simulation/start"]["json"]["max_rounds"], 2)
        self.assertEqual(calls["/api/simulation/start"]["json"]["platform"], "twitter")
        self.assertFalse(calls["/api/simulation/start"]["json"]["enable_graph_memory_update"])
        self.assertEqual(api.ownership[-1], ("proj_fixture", "graph_fixture", "completed"))
        paths = [path for _, path, _ in api.calls]
        self.assertLess(paths.index("/api/simulation/close-env"), paths.index("/api/report/generate"))
        self.assertEqual(api.upload["files"][1], "evidence.txt")
        self.assertEqual(api.upload["files"][0].getvalue(), api.body["evidence"].encode())

    def test_population_change_refused_before_start(self):
        api = FixtureApi()
        api.population = 3
        with self.assertRaises(worker.ScenarioRefused):
            worker.execute_pipeline(api, lambda _: 2)
        self.assertFalse(any(path == "/api/simulation/start" for _, path, _ in api.calls))

    def test_oversize_report_is_refused_not_truncated_or_called_complete(self):
        api = FixtureApi()
        api.report = "A" * (worker.MAX_REPORT_CHARS + 1)
        with self.assertRaisesRegex(worker.ScenarioRefused, "report_budget"):
            worker.execute_pipeline(api, lambda _: 2)

    def test_missing_zep_refuses_before_upstream_import(self):
        with patch.dict(os.environ, {"PROXY_KEY": "dummy", "RESEARCH_MODEL": "dummy"}, clear=True):
            with self.assertRaisesRegex(worker.ScenarioRefused, "zep_configuration_required"):
                worker.require_configuration()

    def test_environment_rejects_provider_secrets_and_pins_all_llm_aliases(self):
        env = {"ZEP_API_KEY": "dummy", "PROXY_KEY": "dummy-proxy", "RESEARCH_MODEL": "dummy"}
        with patch.dict(os.environ, {**env, "NVIDIA_API_KEY": "dummy"}, clear=True):
            with self.assertRaisesRegex(worker.ScenarioRefused, "unrelated_credential"):
                worker.require_configuration()
        with patch.dict(os.environ, env, clear=True):
            worker.require_configuration()
            for name in ("LLM_BASE_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE_URL"):
                self.assertEqual(os.environ[name], worker.PROXY_URL)
            self.assertEqual(os.environ["OPENAI_API_KEY"], "dummy-proxy")

    def test_sync_async_clients_cannot_override_parent_proxy(self):
        created = []
        class Client:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
        class AsyncClient(Client):
            pass
        class HttpClient:
            def __init__(self, **kwargs):
                created.append(kwargs)
        fake_openai = types.SimpleNamespace(OpenAI=Client, AsyncOpenAI=AsyncClient)
        fake_httpx = types.SimpleNamespace(Client=HttpClient, AsyncClient=HttpClient, Limits=lambda **kwargs: kwargs)
        with patch.dict(sys.modules, {"openai": fake_openai, "httpx": fake_httpx}), \
                patch.dict(os.environ, {"PROXY_KEY": "dummy"}, clear=True):
            worker.install_openai_guard()
            for cls in (Client, AsyncClient):
                client = cls(base_url="https://untrusted.invalid", api_key="bad", max_retries=99)
                self.assertEqual(client.kwargs["base_url"], worker.PROXY_URL)
                self.assertEqual(client.kwargs["api_key"], "dummy")
                self.assertEqual(client.kwargs["max_retries"], 0)
                self.assertFalse(created[-1]["trust_env"])
                self.assertFalse(created[-1]["follow_redirects"])

    def test_process_guard_prevents_detached_session_and_arbitrary_script(self):
        created = []
        class FakeProcess:
            def __init__(self, args, **kwargs):
                created.append((args, kwargs))
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {"HOME": home}), \
                patch.object(subprocess, "Popen", FakeProcess):
            processes = worker.install_process_guard()
            config = str(Path(home).resolve() / "simulation_config.json")
            args = [sys.executable, str(worker.BACKEND / "scripts/run_twitter_simulation.py"),
                    "--config", config, "--max-rounds", "2"]
            subprocess.Popen(args, start_new_session=True)
            self.assertEqual(len(processes), 1)
            self.assertFalse(created[0][1]["start_new_session"])
            self.assertEqual(created[0][0][2], "--oasis-script")
            with self.assertRaises(worker.ScenarioRefused):
                subprocess.Popen(["sh", "-c", "echo forbidden"])

    def test_wait_never_calls_failed_task_successful(self):
        with tempfile.TemporaryDirectory() as home:
            api = worker.LocalApi(None, Path(home), 10, clock=lambda: 0, sleep=lambda _: None)
            with self.assertRaises(worker.ScenarioRefused):
                api.wait(lambda: {"status": "failed"}, lambda _: True)
            api.clock = lambda: 11
            with self.assertRaisesRegex(worker.ScenarioRefused, "deadline"):
                api.check_deadline()

    def test_graph_id_recorded_before_cloud_mutation_even_if_reply_lost(self):
        api = FixtureApi()
        api.project_id = "proj_fixture"
        observed = []
        class Builder:
            def create_graph(self, name, *, graph_id_callback):
                graph_id_callback("graph_fixture")
                observed.append(list(api.ownership))
                raise TimeoutError("dummy lost reply")
        worker.bind_graph_ownership(Builder, api)
        with self.assertRaises(TimeoutError):
            Builder().create_graph("fixed", graph_id_callback=lambda _: None)
        self.assertEqual(observed, [[("proj_fixture", "graph_fixture")]])
        self.assertEqual(api.graph_id, "graph_fixture")

    def test_twitter_readiness_uses_real_enabled_platform_files(self):
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)
            state = {"status": "ready", "config_generated": True, "profiles_generated": True,
                     "enable_twitter": True, "enable_reddit": False, "entities_count": 2, "profiles_count": 2}
            config = {"simulation_id": "sim_fixture", "agent_configs": [{}, {}],
                      "twitter_config": {"platform": "twitter"}, "reddit_config": None}
            (root / "state.json").write_text(json.dumps(state))
            (root / "simulation_config.json").write_text(json.dumps(config))
            (root / "twitter_profiles.csv").write_text("user_id,name\n0,A\n1,B\n")
            self.assertFalse((root / "reddit_profiles.json").exists())
            self.assertTrue(worker.twitter_prepared(root, "sim_fixture")[0])
            state["status"] = "preparing"
            (root / "state.json").write_text(json.dumps(state))
            self.assertFalse(worker.twitter_prepared(root, "sim_fixture")[0])
            state["status"] = "ready"
            (root / "state.json").write_text(json.dumps(state))
            (root / "twitter_profiles.csv").write_text("user_id,name\n0,A\n")
            self.assertFalse(worker.twitter_prepared(root, "sim_fixture")[0])

    def test_report_constructor_receives_observed_trace_not_only_seed_graph(self):
        api = FixtureApi()
        api.simulation_evidence = api.read_action_evidence("sim_fixture")
        class Report:
            def __init__(self, **kwargs):
                self.requirement = kwargs["simulation_requirement"]
        worker.bind_report_evidence(Report, api)
        report = Report(simulation_requirement="Supplied question")
        self.assertIn('"totalObservedActions": 2', report.requirement)
        self.assertIn("synthetic simulation evidence", report.requirement)
        del api.simulation_evidence
        with self.assertRaises(worker.ScenarioRefused):
            Report(simulation_requirement="Missing scenario")

    def test_trace_evidence_reads_actual_bounded_sqlite_rows(self):
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)
            (root / "twitter").mkdir()
            (root / "twitter/actions.jsonl").write_text('{"event_type":"simulation_end"}\n')
            with sqlite3.connect(root / "twitter_simulation.db") as db:
                db.execute("CREATE TABLE trace(user_id INTEGER,action TEXT,info TEXT,created_at TEXT)")
                db.executemany("INSERT INTO trace VALUES (?,?,?,?)", [
                    (0, "create_post", '{"content":"synthetic fixture"}', str(i)) for i in range(15)])
                db.execute("INSERT INTO trace VALUES (0,'unlisted_action','{}','late')")
            import time
            result = worker.action_evidence(root, time.monotonic() + 5)
            self.assertEqual(result["totalObservedActions"], 15)
            self.assertEqual(len(result["sample"]), 10)
            self.assertEqual(result["actionCounts"], {"create_post": 15})
            self.assertTrue(result["sampleMayBeTruncated"])


if __name__ == "__main__":
    unittest.main()
