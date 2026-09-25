# apex-trader/kronos-service/tests/test_health.py
import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_health_endpoint_reports_ok_with_mocked_predictor():
    with patch("model_loader.get_predictor") as mock_get_predictor:
        mock_get_predictor.return_value = MagicMock()
        import app as app_module
        client = app_module.app.test_client()
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "ok"
        assert body["model"] == "NeoQuasar/Kronos-mini"
