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

import json


def _assert_platform_contract(result, pred_len, last_close):
    """Mirror of the platform validator (backend/src/services/kronosService.ts
    validateKronosForecast): JSON round-trip, positive finite values, exact
    lengths, band order, and meanReturn agreement within 1e-8."""
    resp = json.loads(json.dumps(result))
    for key in ("predictedClose", "upperBand", "lowerBand"):
        assert len(resp[key]) == pred_len, f"{key} length {len(resp[key])} != {pred_len}"
        assert all(isinstance(v, float) and v > 0 and v == v and abs(v) != float("inf")
                   for v in resp[key]), f"{key} has a non-positive/non-finite value: {resp[key]}"
    for i in range(pred_len):
        assert resp["lowerBand"][i] <= resp["predictedClose"][i] <= resp["upperBand"][i], \
            f"band order violated at {i}"
    actual = (resp["predictedClose"][pred_len - 1] - last_close) / last_close
    assert abs(actual - resp["meanReturn"]) <= 1e-8, \
        f"meanReturn delta {abs(actual - resp['meanReturn'])}"


def _paths_predictor(paths):
    """Fake predictor whose predict() returns the given close paths in order,
    one per call — the shape of the real sampled ensemble at T=1.0."""
    mock_predictor = MagicMock()
    state = {"n": 0}

    def fake_predict(df, x_timestamp, y_timestamp, pred_len, **kwargs):
        path = paths[state["n"] % len(paths)]
        state["n"] += 1
        return pd.DataFrame({
            "open": path, "high": [v + 0.1 for v in path], "low": [v - 0.1 for v in path],
            "close": path, "volume": [0.0] * len(path), "amount": [0.0] * len(path),
        })

    mock_predictor.predict.side_effect = fake_predict
    return mock_predictor


def test_run_forecast_diverging_ensemble_keeps_bands_positive_and_ordered():
    # Regression test for the production contract break: at T=1.0 the sampled
    # runs diverge hard — most paths crash toward zero while one sits at the
    # last close. With the OLD mean - std band this ensemble produced
    # lowerBand < 0 and the platform validator rejected the response on
    # positivity. Verify that diagnosis in-test, then verify the fix.
    ohlcv = _make_ohlcv(60)
    last_close = float(ohlcv[-1]["close"])
    paths = [[159.0] * 5, [2.0] * 5, [3.0] * 5, [1.0] * 5, [165.0] * 5]
    import numpy as np
    matrix = np.array(paths, dtype=float)
    old_lower = matrix.mean(axis=0) - matrix.std(axis=0)
    assert old_lower[0] <= 0, "precondition: old mean-std band must break positivity here"

    result = run_forecast(_paths_predictor(paths), ohlcv, pred_len=5, ensemble_size=5)
    _assert_platform_contract(result, pred_len=5, last_close=last_close)


def test_run_forecast_negative_sampled_path_stays_positive():
    # The vendored model's denormalization is affine and unclamped, so a
    # sampled path can go negative. The response must still be all-positive.
    ohlcv = _make_ohlcv(60)
    last_close = float(ohlcv[-1]["close"])
    paths = [[160.0] * 5, [158.0] * 5, [161.0] * 5, [-6.0] * 5, [160.5] * 5]
    result = run_forecast(_paths_predictor(paths), ohlcv, pred_len=5, ensemble_size=5)
    _assert_platform_contract(result, pred_len=5, last_close=last_close)


def test_run_forecast_normalizes_predict_row_count():
    # predict() returning more or fewer rows than pred_len must not leak
    # into the response: the platform demands exact lengths.
    ohlcv = _make_ohlcv(60)
    last_close = float(ohlcv[-1]["close"])
    for rows in (7, 3):
        mock_predictor = MagicMock()
        mock_predictor.predict.return_value = pd.DataFrame({
            "open": [159.0] * rows, "high": [160.0] * rows, "low": [158.0] * rows,
            "close": [159.5] * rows, "volume": [0.0] * rows, "amount": [0.0] * rows,
        })
        result = run_forecast(mock_predictor, ohlcv, pred_len=5, ensemble_size=2)
        _assert_platform_contract(result, pred_len=5, last_close=last_close)


def test_run_forecast_normalizes_ragged_runs():
    # Runs of differing lengths used to crash the np.array stacking (ragged)
    # or leak wrong lengths; each run is normalized independently now.
    ohlcv = _make_ohlcv(60)
    last_close = float(ohlcv[-1]["close"])
    paths = [[159.0] * 7, [160.0] * 5, [158.5] * 3, [159.2] * 5, [159.8] * 6]
    result = run_forecast(_paths_predictor(paths), ohlcv, pred_len=5, ensemble_size=5)
    _assert_platform_contract(result, pred_len=5, last_close=last_close)

def _float32_paths_predictor(paths):
    """Fake predictor whose predict() returns float32 close arrays — the
    real model's dtype (the vendored library builds its DataFrame from
    float32 torch tensors), unlike _paths_predictor's float64 lists."""
    import numpy as np
    mock_predictor = MagicMock()
    state = {"n": 0}

    def fake_predict(df, x_timestamp, y_timestamp, pred_len, **kwargs):
        path = np.asarray(paths[state["n"] % len(paths)], dtype=np.float32)
        state["n"] += 1
        return pd.DataFrame({
            "open": path, "high": path, "low": path, "close": path,
            "volume": np.zeros(len(path), dtype=np.float32),
            "amount": np.zeros(len(path), dtype=np.float32),
        })

    mock_predictor.predict.side_effect = fake_predict
    return mock_predictor


def test_run_forecast_float32_ensemble_mean_return_matches_validator():
    # Regression test for the 2026-10-23 production rejection:
    #   Kronos response rejected: meanReturn mismatch
    #   {"symbol":"ONDS","check":"meanReturn","delta":3.17e-8,...}
    # The vendored model returns float32 closes. Where that dtype reached
    # the meanReturn arithmetic (float32 ensemble matrix -> float32 mean ->
    # float32 (mean - last) / last under NumPy 2 / NEP 50 promotion), the
    # result drifted ~1e-8..3e-8 from the platform validator's float64
    # recomputation — outside its 1e-8 tolerance — and the Quant
    # Forecaster sat at HOLD with confidence 0. The PR #72 fixtures were
    # float64 Python lists, so the hazard never fired in tests.
    #
    # Fixture: an ONDS-shaped ensemble — last close 9.63, five sampled
    # paths ending ~17% lower over a 24-step horizon.
    import numpy as np
    ohlcv = [
        {"open": c, "high": c + 0.1, "low": c - 0.1, "close": c, "volume": 1e6,
         "timestamp": f"2026-01-{(i % 28) + 1:02d}T00:00:00"}
        for i, c in enumerate(np.linspace(8.0, 9.63, 60))
    ]
    last_close = 9.63
    rng = np.random.default_rng(504)
    factors = np.array([0.79, 0.81, 0.83, 0.85, 0.86]) + rng.normal(0, 0.01, 5)
    paths = [np.linspace(9.55, last_close * f, 24) + rng.normal(0, 0.03, 24)
             for f in factors]

    # Precondition (same style as the band regression test above): had
    # these float32 outputs been aggregated in float32, as the pre-fix
    # code did with the real model's runs, meanReturn would land outside
    # the validator's tolerance for this very ensemble.
    matrix32 = np.array(paths, dtype=np.float32)
    mean32 = matrix32.mean(axis=0)
    mean_return_f32 = float((mean32[-1] - np.float32(last_close)) / np.float32(last_close))
    validator_from_f32_mean = (float(mean32[-1]) - last_close) / last_close
    assert abs(validator_from_f32_mean - mean_return_f32) > 1e-8, \
        "precondition: the float32 path must break the 1e-8 tolerance here"

    result = run_forecast(_float32_paths_predictor(paths), ohlcv, pred_len=24, ensemble_size=5)
    _assert_platform_contract(result, pred_len=24, last_close=last_close)

    # Stronger than the tolerance: the fix derives meanReturn from the
    # returned predictedClose values, so after a JSON round-trip the
    # validator's recomputation agrees exactly (delta 0 by construction).
    resp = json.loads(json.dumps(result))
    assert (resp["predictedClose"][-1] - last_close) / last_close == resp["meanReturn"]
