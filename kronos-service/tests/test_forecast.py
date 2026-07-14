# apex-trader/kronos-service/tests/test_forecast.py
import sys
import os
from unittest.mock import MagicMock
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from forecast import run_forecast


def _make_ohlcv(n=30):
    return [
        {"open": 100 + i, "high": 101 + i, "low": 99 + i, "close": 100.5 + i, "volume": 1000.0,
         "timestamp": f"2026-01-{(i % 28) + 1:02d}T00:00:00"}
        for i in range(n)
    ]


def test_run_forecast_returns_mean_and_band_from_ensemble():
    mock_predictor = MagicMock()
    # Each call to predict() returns a slightly different close path — simulates
    # sampling variance across independent ensemble runs.
    call_count = {"n": 0}

    def fake_predict(df, x_timestamp, y_timestamp, pred_len, **kwargs):
        call_count["n"] += 1
        offset = call_count["n"]  # 1, 2, 3, ... — distinct per call
        return pd.DataFrame({
            "open": [110.0 + offset] * pred_len,
            "high": [111.0 + offset] * pred_len,
            "low": [109.0 + offset] * pred_len,
            "close": [110.5 + offset] * pred_len,
            "volume": [0.0] * pred_len,
            "amount": [0.0] * pred_len,
        })

    mock_predictor.predict.side_effect = fake_predict

    result = run_forecast(mock_predictor, _make_ohlcv(), pred_len=3, ensemble_size=5)

    assert mock_predictor.predict.call_count == 5
    assert len(result["predictedClose"]) == 3
    assert len(result["upperBand"]) == 3
    assert len(result["lowerBand"]) == 3
    # Mean of closes 111.5..115.5 (offsets 1-5) = 113.5
    assert abs(result["predictedClose"][0] - 113.5) < 0.01
    # Ensemble has real spread, so the band must not collapse to the mean
    assert result["upperBand"][0] > result["predictedClose"][0]
    assert result["lowerBand"][0] < result["predictedClose"][0]
    assert isinstance(result["meanReturn"], float)


def test_run_forecast_single_sample_still_returns_band_equal_to_mean():
    mock_predictor = MagicMock()
    mock_predictor.predict.return_value = pd.DataFrame({
        "open": [110.0], "high": [111.0], "low": [109.0], "close": [110.5],
        "volume": [0.0], "amount": [0.0],
    })
    result = run_forecast(mock_predictor, _make_ohlcv(), pred_len=1, ensemble_size=1)
    assert result["upperBand"][0] == result["predictedClose"][0] == result["lowerBand"][0]


from unittest.mock import patch


def test_forecast_route_rejects_empty_ohlcv():
    import app as app_module
    client = app_module.app.test_client()
    resp = client.post("/forecast", json={"symbol": "AAPL", "ohlcv": [], "predLen": 3})
    assert resp.status_code == 400


def test_forecast_route_rejects_missing_pred_len():
    import app as app_module
    client = app_module.app.test_client()
    resp = client.post("/forecast", json={"symbol": "AAPL", "ohlcv": _make_ohlcv()})
    assert resp.status_code == 400


def test_forecast_route_returns_200_with_mocked_predictor():
    import app as app_module
    with patch("app.model_loader.get_predictor") as mock_get_predictor:
        mock_predictor = MagicMock()
        mock_predictor.predict.return_value = pd.DataFrame({
            "open": [110.0], "high": [111.0], "low": [109.0], "close": [110.5],
            "volume": [0.0], "amount": [0.0],
        })
        mock_get_predictor.return_value = mock_predictor
        client = app_module.app.test_client()
        resp = client.post("/forecast", json={"symbol": "AAPL", "ohlcv": _make_ohlcv(), "predLen": 1})
        assert resp.status_code == 200
        assert resp.get_json()["symbol"] == "AAPL"
