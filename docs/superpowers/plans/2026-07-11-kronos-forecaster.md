# Kronos Quant Forecaster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Python microservice wrapping the MIT-licensed `shiyu-coder/Kronos` forecasting model, and wire its output in as Agent #14 ("Quant Forecaster") in the existing 13-agent investment-committee debate (`debateEngine.ts`), following Component 1 of `docs/superpowers/specs/2026-07-11-backend-intelligence-upgrade-design.md`.

**Architecture:** A standalone Flask service (`kronos-service/`, Python 3.11, CPU-only) loads Kronos-mini once at boot and exposes `POST /forecast`, which runs the model's own `predict()` several independent times (an ensemble) to derive a mean price path plus a std-dev confidence band — the vendored library only returns a single averaged point forecast per call, with no built-in variance output. The existing Node backend calls this over Railway's private network via a new `kronosService.ts` client (same retry-on-429/5xx spirit as `debateEngine.ts`'s `callWithRetry`, but generic to axios). The forecast gets folded into the same shared `round1Prompt` context every agent already reads (exactly how `macroSummary`/`optionsSummary` are wired in today), plus a new roster entry gives the "Quant Forecaster" persona a systemPrompt calling it out.

**Tech Stack:** Python 3.11 + Flask + PyTorch + the vendored Kronos library (Node side: existing TypeScript/Express/axios stack, no new npm packages).

## Global Constraints

- Kronos service code lives in `apex-trader/kronos-service/` — a new top-level sibling to `backend/` and `frontend/`, not nested inside either.
- Model: **Kronos-mini** (`NeoQuasar/Kronos-mini`, 4.1M params, `NeoQuasar/Kronos-Tokenizer-2k`, 2048-bar context) — smallest released variant, chosen for CPU latency headroom since the ensemble step (Task 2) calls `predict()` multiple times per request. If forecast quality is later found lacking, swapping to `Kronos-small` is a one-line env var change (`KRONOS_MODEL_ID`), not a rewrite — do not build that swap mechanism now (YAGNI), just use the env var directly.
- No GPU. `KronosPredictor(model, tokenizer, device=None, ...)` already auto-falls-back to CPU when no CUDA/MPS is present (`model/kronos.py:494-501` in the vendored copy) — do not hardcode `device="cpu"` unnecessarily, just don't pass a GPU device.
- The vendored Kronos source (`C:\Users\mrtha\Desktop\platform-repos\Kronos`, MIT-licensed) is copied into `kronos-service/kronos_lib/` as-is (its `model/` package) — do not modify its internals. The confidence-band requirement is met by calling its public `predict()` method N times from our own wrapper code, not by patching the library.
- Railway service reachability: this service is called only from the existing Node backend over Railway's private network (internal hostname, not a public domain) — no auth token needed on `/forecast`, matching how the project's own Postgres addon is internal-only. Do not add JWT/API-key auth to this internal service (YAGNI — it's not internet-reachable).
- **Explicitly out of scope, not silently dropped:** Kronos's `predict_batch()` (parallel multi-symbol forecasting in one call) is not used — this project's debate engine runs one asset per debate sequentially, so there's no existing batching point to hook it into without restructuring the scan scheduler itself. `run_forecast()` (Task 2) calls single-symbol `predict()` repeatedly instead, which is what the ensemble/confidence-band requirement needs regardless of batching. Revisit `predict_batch()` only if the scan scheduler itself is later restructured to evaluate multiple symbols per Kronos round-trip for latency reasons.
- Node-side Prisma import path convention (if any task touches Prisma, none currently do): `import { prisma } from '../utils/prisma';`.
- Existing Node test convention: Jest, `jest.mock()` narrow collaborators, no supertest/HTTP-layer tests, no test DB (matches `tests/executionEngine.test.ts`).
- Python test convention (new for this project): `pytest`, mock `KronosPredictor` itself (not internals) so tests never need real model weights or network access.
- Commit after every task, not after every step within a task.

---

## Task 1: Kronos service scaffold — Flask app, model loading at boot, `/health`

**Files:**
- Create: `apex-trader/kronos-service/requirements.txt`
- Create: `apex-trader/kronos-service/app.py`
- Create: `apex-trader/kronos-service/model_loader.py`
- Copy: `C:\Users\mrtha\Desktop\platform-repos\Kronos\model\` → `apex-trader/kronos-service/kronos_lib/model/` (vendored library, MIT license — copy the `LICENSE` file alongside it into `kronos-service/kronos_lib/LICENSE`)
- Test: `apex-trader/kronos-service/tests/test_health.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `model_loader.get_predictor() -> KronosPredictor` (module-level singleton, loaded once at import time). `GET /health` → `{"status": "ok", "model": "NeoQuasar/Kronos-mini", "device": "cpu"}` once the predictor has loaded; Task 2 imports `get_predictor` to build the forecast endpoint.

- [ ] **Step 1: Copy the vendored Kronos library**

Copy the `model/` directory from `C:\Users\mrtha\Desktop\platform-repos\Kronos\model` into `apex-trader/kronos-service/kronos_lib/model/` (preserve `__init__.py`, `kronos.py`, and any other files in that directory — do not cherry-pick individual files). Copy `C:\Users\mrtha\Desktop\platform-repos\Kronos\LICENSE` to `apex-trader/kronos-service/kronos_lib/LICENSE`. Create an empty `apex-trader/kronos-service/kronos_lib/__init__.py`.

- [ ] **Step 2: Write `requirements.txt`**

```
flask==3.0.3
flask-cors==4.0.1
numpy
pandas==2.2.2
torch>=2.0.0
einops==0.8.1
huggingface_hub==0.33.1
safetensors==0.6.2
pytest==8.3.3
requests==2.32.3
```

(Matches the vendored library's own `requirements.txt` versions for `pandas`/`einops`/`huggingface_hub`/`safetensors`/`torch`, per this session's research of the Kronos repo — plus Flask/pytest/requests for this service itself. `matplotlib`/`tqdm` from the original repo are demo-only, not needed for a headless service — omitted.)

- [ ] **Step 3: Write `model_loader.py`**

```python
# apex-trader/kronos-service/model_loader.py
import logging
import os

from kronos_lib.model.kronos import Kronos, KronosTokenizer, KronosPredictor

logger = logging.getLogger(__name__)

MODEL_ID = os.environ.get("KRONOS_MODEL_ID", "NeoQuasar/Kronos-mini")
TOKENIZER_ID = os.environ.get("KRONOS_TOKENIZER_ID", "NeoQuasar/Kronos-Tokenizer-2k")
MAX_CONTEXT = int(os.environ.get("KRONOS_MAX_CONTEXT", "2048"))

_predictor = None


def get_predictor() -> KronosPredictor:
    global _predictor
    if _predictor is None:
        logger.info(f"Loading Kronos model={MODEL_ID} tokenizer={TOKENIZER_ID}")
        tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
        model = Kronos.from_pretrained(MODEL_ID)
        _predictor = KronosPredictor(model, tokenizer, device=None, max_context=MAX_CONTEXT, clip=5)
        logger.info("Kronos model loaded")
    return _predictor
```

- [ ] **Step 4: Write the failing health-check test**

```python
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd apex-trader/kronos-service && pip install -r requirements.txt && pytest tests/test_health.py -v`
Expected: FAIL — `app.py` doesn't exist yet.

- [ ] **Step 6: Write `app.py`**

```python
# apex-trader/kronos-service/app.py
import logging

from flask import Flask, jsonify
from flask_cors import CORS

import model_loader

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
CORS(app)


@app.route("/health", methods=["GET"])
def health():
    model_loader.get_predictor()  # triggers load on first call if not already loaded
    return jsonify({"status": "ok", "model": model_loader.MODEL_ID, "device": "cpu"})


if __name__ == "__main__":
    model_loader.get_predictor()  # load at boot, not on first request
    app.run(host="0.0.0.0", port=int(__import__("os").environ.get("PORT", "8000")))
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apex-trader/kronos-service && pytest tests/test_health.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd apex-trader
git add kronos-service/
git commit -m "Scaffold Kronos forecasting service: Flask app, model loader, /health

Vendors shiyu-coder/Kronos's MIT-licensed model/ package as-is (no
modifications). Loads Kronos-mini (4.1M params, CPU) once at boot via a
module-level singleton predictor."
```

---

## Task 2: `POST /forecast` — ensemble prediction with a real confidence band

**Files:**
- Modify: `apex-trader/kronos-service/app.py`
- Create: `apex-trader/kronos-service/forecast.py`
- Test: `apex-trader/kronos-service/tests/test_forecast.py`

**Interfaces:**
- Consumes: `model_loader.get_predictor()` (Task 1).
- Produces: `forecast.run_forecast(predictor, ohlcv: list[dict], pred_len: int, ensemble_size: int = 5) -> dict` returning `{"predictedClose": [float, ...], "upperBand": [float, ...], "lowerBand": [float, ...], "meanReturn": float}` — one entry per predicted bar. `POST /forecast` body `{"symbol": str, "ohlcv": [{"open": float, "high": float, "low": float, "close": float, "volume": float, "timestamp": str}, ...], "predLen": int}`, 200 response `{"symbol": ..., "predictedClose": [...], "upperBand": [...], "lowerBand": [...], "meanReturn": ...}`, 400 if `ohlcv` is empty or `predLen` is missing/non-positive.

- [ ] **Step 1: Write the failing test for `run_forecast`**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apex-trader/kronos-service && pytest tests/test_forecast.py -v`
Expected: FAIL — `forecast.py` doesn't exist yet.

- [ ] **Step 3: Write `forecast.py`**

```python
# apex-trader/kronos-service/forecast.py
import pandas as pd
import numpy as np


def run_forecast(predictor, ohlcv: list, pred_len: int, ensemble_size: int = 5) -> dict:
    df = pd.DataFrame(ohlcv)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    x_timestamp = df["timestamp"]

    last_ts = df["timestamp"].iloc[-1]
    freq = pd.infer_freq(df["timestamp"]) or "D"
    y_timestamp = pd.Series(pd.date_range(start=last_ts, periods=pred_len + 1, freq=freq)[1:])

    # The vendored predict() only returns an averaged point forecast per call
    # (it averages sample_count internally before returning) — there is no
    # built-in variance/quantile output. Running it multiple independent times
    # and taking mean/std across runs is how we get a real confidence band
    # without forking the vendored library.
    close_runs = []
    for _ in range(ensemble_size):
        pred_df = predictor.predict(
            df[["open", "high", "low", "close", "volume"]], x_timestamp, y_timestamp, pred_len,
            T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=False,
        )
        close_runs.append(pred_df["close"].to_numpy())

    close_matrix = np.array(close_runs)  # shape (ensemble_size, pred_len)
    mean_close = close_matrix.mean(axis=0)
    std_close = close_matrix.std(axis=0)

    last_close = float(df["close"].iloc[-1])
    mean_return = float((mean_close[-1] - last_close) / last_close)

    return {
        "predictedClose": mean_close.tolist(),
        "upperBand": (mean_close + std_close).tolist(),
        "lowerBand": (mean_close - std_close).tolist(),
        "meanReturn": mean_return,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apex-trader/kronos-service && pytest tests/test_forecast.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the route into `app.py`**

Add to `apex-trader/kronos-service/app.py` (after the `/health` route):

```python
from flask import request
from forecast import run_forecast

@app.route("/forecast", methods=["POST"])
def forecast_route():
    body = request.get_json(force=True)
    ohlcv = body.get("ohlcv")
    pred_len = body.get("predLen")
    symbol = body.get("symbol", "UNKNOWN")

    if not ohlcv or not isinstance(ohlcv, list):
        return jsonify({"error": "ohlcv must be a non-empty list"}), 400
    if not isinstance(pred_len, int) or pred_len <= 0:
        return jsonify({"error": "predLen must be a positive integer"}), 400

    predictor = model_loader.get_predictor()
    result = run_forecast(predictor, ohlcv, pred_len)
    result["symbol"] = symbol
    return jsonify(result)
```

- [ ] **Step 6: Write a failing test for the route's validation branches**

```python
# append to apex-trader/kronos-service/tests/test_forecast.py
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
```

- [ ] **Step 7: Run all forecast tests to verify they pass**

Run: `cd apex-trader/kronos-service && pytest tests/test_forecast.py -v`
Expected: PASS (5 tests total)

- [ ] **Step 8: Commit**

```bash
cd apex-trader
git add kronos-service/app.py kronos-service/forecast.py kronos-service/tests/test_forecast.py
git commit -m "Add POST /forecast with a real ensemble-derived confidence band

predict() only returns one averaged point forecast per call with no
variance output, so run_forecast() calls it 5 independent times and
derives mean/std across runs — a real confidence band, not a placeholder."
```

---

## Task 3: Railway deployment config for the Kronos service

**Files:**
- Create: `apex-trader/kronos-service/railway.json`
- Create: `apex-trader/kronos-service/nixpacks.toml`
- Create: `apex-trader/kronos-service/.gitignore`

**Interfaces:**
- Consumes: nothing new.
- Produces: a deployable Railway service definition. No test — this task is infra config, verified by a manual deploy check in Step 4.

- [ ] **Step 1: Write `nixpacks.toml`**

```toml
# apex-trader/kronos-service/nixpacks.toml
[phases.setup]
nixPkgs = ["python311"]

[phases.install]
cmds = ["pip install -r requirements.txt"]

[start]
cmd = "python app.py"
```

- [ ] **Step 2: Write `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "python app.py",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

(Per this project's own build-gotcha history documented in project memory — `backend/railway.json`'s explicit `buildCommand` silently overriding `nixpacks.toml` — this file intentionally does NOT set a `build.buildCommand`, so `nixpacks.toml`'s install phase is the one and only build path for this service, with no conflicting override.)

- [ ] **Step 3: Write `.gitignore`**

```
__pycache__/
*.pyc
.pytest_cache/
venv/
.env
```

- [ ] **Step 4: Manual deploy verification**

In the Railway dashboard, add a new service to the existing "artistic-imagination" project, pointing at this repo with root directory `apex-trader/kronos-service`. After deploy, call the service's `/health` endpoint (via its public Railway domain, temporarily enabled for this manual check) and confirm `{"status": "ok", "model": "NeoQuasar/Kronos-mini", "device": "cpu"}`. Then note the service's internal Railway hostname (e.g. `kronos-service.railway.internal`) for Task 4/5's `KRONOS_SERVICE_URL`, and disable the public domain again once confirmed (per the Global Constraints: internal-only, no public exposure needed day to day).

- [ ] **Step 5: Commit**

```bash
cd apex-trader
git add kronos-service/railway.json kronos-service/nixpacks.toml kronos-service/.gitignore
git commit -m "Add Railway deploy config for the Kronos service (Python/nixpacks)

No build.buildCommand override in railway.json, so nixpacks.toml's install
phase is the single build path — avoids the buildCommand-silently-wins
gotcha already hit twice on the backend service (see project memory)."
```

---

## Task 4: Node `kronosService.ts` client

**Files:**
- Create: `apex-trader/backend/src/services/kronosService.ts`
- Test: `apex-trader/backend/tests/kronosService.test.ts`

**Interfaces:**
- Consumes: `axios` (already a dependency, used elsewhere in this codebase for external HTTP calls).
- Produces: `getForecast(symbol: string, ohlcv: Candle[], predLen: number): Promise<KronosForecast | null>` where `KronosForecast = { symbol: string; predictedClose: number[]; upperBand: number[]; lowerBand: number[]; meanReturn: number }`. Returns `null` (never throws) if the service is unreachable or returns a non-2xx status after retries — callers treat a `null` forecast the same way `deepAnalysis`/`intermarket`/`optionsFlow` already treat their own `.catch(() => null)` fallbacks in `debateEngine.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apex-trader/backend/tests/kronosService.test.ts
import axios from 'axios';
import { getForecast } from '../src/services/kronosService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const candles = Array.from({ length: 10 }, (_, i) => ({
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
  timestamp: Date.now() - (10 - i) * 86400000,
}));

describe('kronosService.getForecast', () => {
  beforeEach(() => {
    process.env.KRONOS_SERVICE_URL = 'http://kronos-service.railway.internal:8000';
    jest.clearAllMocks();
  });

  it('returns the parsed forecast on a 200 response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.05 },
    });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result).toEqual({ symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.05 });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://kronos-service.railway.internal:8000/forecast',
      expect.objectContaining({ symbol: 'AAPL', predLen: 1 }),
      expect.any(Object),
    );
  });

  it('returns null (not a throw) when every retry fails', async () => {
    mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result).toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('retries once on a 503 then succeeds', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce({
        status: 200,
        data: { symbol: 'AAPL', predictedClose: [111], upperBand: [113], lowerBand: [109], meanReturn: 0.05 },
      });
    const result = await getForecast('AAPL', candles as any, 1);
    expect(result?.symbol).toBe('AAPL');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/kronosService.test.ts --forceExit`
Expected: FAIL — `src/services/kronosService.ts` doesn't exist yet.

- [ ] **Step 3: Write `kronosService.ts`**

```ts
// apex-trader/backend/src/services/kronosService.ts
import axios from 'axios';
import { logger } from '../utils/logger';

interface Candle {
  open: number; high: number; low: number; close: number; volume: number; timestamp: number;
}

export interface KronosForecast {
  symbol: string;
  predictedClose: number[];
  upperBand: number[];
  lowerBand: number[];
  meanReturn: number;
}

const MAX_RETRIES = 2;

export async function getForecast(symbol: string, candles: Candle[], predLen: number): Promise<KronosForecast | null> {
  const baseUrl = process.env.KRONOS_SERVICE_URL;
  if (!baseUrl) {
    logger.warn('KRONOS_SERVICE_URL not set — skipping Kronos forecast');
    return null;
  }

  const ohlcv = candles.map(c => ({
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    timestamp: new Date(c.timestamp).toISOString(),
  }));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${baseUrl}/forecast`,
        { symbol, ohlcv, predLen },
        { timeout: 10000 },
      );
      if (response.status === 200) {
        return response.data as KronosForecast;
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logger.error('Kronos forecast failed after retries', { symbol, err: (err as Error)?.message || err });
        return null;
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/kronosService.test.ts --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd apex-trader
git add backend/src/services/kronosService.ts backend/tests/kronosService.test.ts
git commit -m "Add kronosService.ts client for the new Kronos forecasting service

Never throws — returns null on failure after 2 retries, matching the
existing .catch(() => null) resilience pattern debateEngine.ts already
uses for deepAnalysis/intermarket/optionsFlow."
```

---

## Task 5: Wire Agent #14 "Quant Forecaster" into the debate

**Files:**
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (`AGENT_ROSTER`, the `Promise.all` block at line 497, `buildMarketContext` at line 911)
- Test: `apex-trader/backend/tests/debateEngine.kronosAgent.test.ts`

**Interfaces:**
- Consumes: `getForecast` (Task 4).
- Produces: `AGENT_ROSTER` gains a 14th entry `{ id: 14, name: 'Quant Forecaster', icon: '🔮', systemPrompt: <below> }`. `buildMarketContext` gains a 9th parameter `forecastSummary = ''`. `round1Roster` (currently `AGENT_ROSTER.filter(a => a.id !== 10)`) continues to only exclude id 10 — agent 14 is a normal round-1 participant, not a second-pass agent like Devil's Advocate, so no new filter is needed.

- [ ] **Step 1: Write the failing tests**

```ts
// apex-trader/backend/tests/debateEngine.kronosAgent.test.ts
describe('Agent #14 — Quant Forecaster wiring', () => {
  it('AGENT_ROSTER includes id 14 with the Quant Forecaster persona', () => {
    const { AGENT_ROSTER } = require('../src/agents/debateEngine');
    const agent14 = AGENT_ROSTER.find((a: any) => a.id === 14);
    expect(agent14).toBeDefined();
    expect(agent14.name).toBe('Quant Forecaster');
    expect(typeof agent14.systemPrompt).toBe('string');
    expect(agent14.systemPrompt.length).toBeGreaterThan(0);
  });

  it('round1Roster still excludes only id 10 (Devil\'s Advocate), not id 14', () => {
    const debateEngineSrc = require('fs').readFileSync(
      require('path').join(__dirname, '../src/agents/debateEngine.ts'), 'utf-8'
    );
    const match = debateEngineSrc.match(/AGENT_ROSTER\.filter\(a => a\.id !== (\d+)\)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('10');
  });

  it('buildMarketContext includes the forecast section when forecastSummary is provided', () => {
    const { __test__buildMarketContext } = require('../src/agents/debateEngine');
    const snapshot = {
      asset: 'AAPL', price: 150, priceChangePct24h: 1.2, volume24h: 1000000,
      indicators: {
        rsi14: 55, macd: { histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
        bollingerBands: { upper: 155, middle: 150, lower: 145 },
        ema9: 151, ema21: 149, ema200: 140, sma50: 148, sma200: 142,
        vwap: 150, atr14: 2, week52High: 160, week52Low: 120, distanceFrom52wHigh: 6,
        fibonacci: { r236: 152, r382: 150, r500: 148, r618: 146 },
        isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, obv: 1,
      },
    };
    const portfolio = { totalValue: 100000, cashBalance: 40000, pnlDayPct: 0 };
    const context = __test__buildMarketContext(
      snapshot, portfolio, 'TRENDING', '', '', '', '', '',
      'Predicted close (5-bar): $152.30 (band $150.10-$154.50) | Expected return: +1.5%'
    );
    expect(context).toContain('QUANT FORECAST');
    expect(context).toContain('152.30');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.kronosAgent.test.ts --forceExit`
Expected: FAIL — no id 14 in `AGENT_ROSTER`, `__test__buildMarketContext` not exported, no forecast section in the prompt builder.

- [ ] **Step 3: Add the Agent #14 roster entry**

In `apex-trader/backend/src/agents/debateEngine.ts`, add to `AGENT_ROSTER` (after the existing id 13 "Arbitrageur" entry):

```ts
  {
    id: 14,
    name: 'Quant Forecaster',
    icon: '🔮',
    systemPrompt: `You are the Quant Forecaster, reading output from a machine-learning price forecasting model (Kronos), not classical technical indicators. Focus your argument on the QUANT FORECAST section of the market context: the model's predicted close, its confidence band width (a wide band = high model uncertainty, argue for caution and lower confidence; a narrow band = high model conviction), and the expected return direction/magnitude. If no QUANT FORECAST section is present, say so explicitly and vote HOLD with low confidence — do not fabricate a forecast opinion from other agents' data.`,
  },
```

- [ ] **Step 4: Export `buildMarketContext` for testing and add the forecast parameter**

Change the function signature (line 911-920) from:
```ts
function buildMarketContext(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  fundamentals = '',
  stockMemory = '',
  newsSummary = '',
  macroSummary = '',
  optionsSummary = ''
): string {
```
to:
```ts
export function buildMarketContext(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  fundamentals = '',
  stockMemory = '',
  newsSummary = '',
  macroSummary = '',
  optionsSummary = '',
  forecastSummary = ''
): string {
```

Add a re-export alias right after the function so the test's exact name works without coupling the test to the real (already-descriptive) function name:
```ts
export const __test__buildMarketContext = buildMarketContext;
```

Add the new section to the `lines` array, immediately after the existing `optionsSummary` block (find the `if (optionsSummary)` block near line 951 and add directly after its closing brace):
```ts
  if (forecastSummary) {
    lines.push(`── QUANT FORECAST (Kronos ML model) ──`, forecastSummary);
  }
```

- [ ] **Step 5: Run the roster/context tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.kronosAgent.test.ts --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 6: Fetch the forecast in the shared `Promise.all` and format it**

In the `Promise.all` block (line 497-502), add a 5th parallel fetch:
```ts
  const [deepAnalysis, stockMemory, intermarket, optionsFlow, kronosForecast] = await Promise.all([
    snapshot.market === 'stocks' ? fetchDeepAnalysis(asset).catch(() => null) : Promise.resolve(null),
    getStockMemorySummary(asset),
    intermarketService.getIntermarketAnalysis().catch(() => null),
    snapshot.market === 'stocks' ? optionsFlowService.analyzeOptionsFlow(asset, snapshot.price).catch(() => null) : Promise.resolve(null),
    getForecast(asset, snapshot.recentCandles ?? [], 5).catch(() => null),
  ]);
```

(`snapshot.recentCandles` — confirm the exact field name on `MarketSnapshot` that holds recent OHLCV bars before finalizing; if `MarketSnapshot` doesn't already carry recent candles, grep `calculateIndicators`'s caller for whatever variable holds the raw candle array fetched earlier in the same request path, and thread that through instead of inventing a new field — this data is already fetched to compute the existing indicators, so it exists somewhere in scope.)

Add the import at the top of the file: `import { getForecast } from '../services/kronosService';`

After the existing `optionsSummary` construction (around line 528), add:
```ts
  const forecastSummary = kronosForecast && kronosForecast.predictedClose.length > 0
    ? `Predicted close (${kronosForecast.predictedClose.length}-bar): $${kronosForecast.predictedClose[kronosForecast.predictedClose.length - 1].toFixed(2)} ` +
      `(band $${kronosForecast.lowerBand[kronosForecast.lowerBand.length - 1].toFixed(2)}-$${kronosForecast.upperBand[kronosForecast.upperBand.length - 1].toFixed(2)}) | ` +
      `Expected return: ${kronosForecast.meanReturn >= 0 ? '+' : ''}${(kronosForecast.meanReturn * 100).toFixed(2)}%`
    : '';
```

Update the `buildMarketContext` call site (line 536) to pass it:
```ts
  const round1Prompt = buildMarketContext(snapshot, portfolio, marketRegime, fundamentalsSummary, stockMemory, newsSummary, macroSummary, optionsSummary, forecastSummary);
```

- [ ] **Step 7: Run the full debateEngine-related test suite to verify no regressions**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.kronosAgent.test.ts tests/kronosService.test.ts --forceExit`
Expected: PASS (6 tests total)

- [ ] **Step 8: Commit**

```bash
cd apex-trader
git add backend/src/agents/debateEngine.ts backend/tests/debateEngine.kronosAgent.test.ts
git commit -m "Wire Agent #14 Quant Forecaster into the investment-committee debate

Forecast is fetched in the same shared Promise.all as deepAnalysis/
intermarket/optionsFlow and folded into the one round1Prompt every agent
already reads (same pattern as macroSummary/optionsSummary) — no
per-agent-conditional data injection needed, since none of the existing
13 agents use one either. round1Roster's existing filter (a.id !== 10)
is untouched: agent 14 is a normal round-1 participant, not a
second-pass agent like Devil's Advocate."
```

---

## Task 6: Frontend agent-count copy (13 → 14)

**Files:**
- Modify: `apex-trader/frontend/src/pages/AgentMonitor.tsx:164`
- Modify: `apex-trader/frontend/src/pages/Settings.tsx:64`
- Modify: `apex-trader/frontend/src/services/socket.ts:36`

**Interfaces:**
- Consumes: nothing.
- Produces: no behavior change, copy only.

- [ ] **Step 1: Update each file**

Read each of the three files at the line numbers above and change every occurrence of the literal string `"13"` (in the context of the agent-count copy, e.g. `"13 agents"`, `"13 SPECIALISTS"`) to `"14"`. Do not touch unrelated numeric literals in the same files — read enough surrounding context at each line to confirm it's the agent-count string before editing, since `sed`-style blind replacement of "13" could hit an unrelated number.

- [ ] **Step 2: Grep to confirm no other stale count was missed**

Run: `cd apex-trader/frontend && grep -rn '"13 ' src/ ; grep -rn "13 agents" src/ ; grep -rn "13 SPECIALISTS" src/`
Expected: no remaining matches (the disconnected mock in `frontend/tests/components.test.ts:11,78-80` says "10 agent" and is a separate, self-contained mock array unrelated to `AGENT_ROSTER` — leave it untouched, it is not part of this task's scope).

- [ ] **Step 3: Commit**

```bash
cd apex-trader
git add frontend/src/pages/AgentMonitor.tsx frontend/src/pages/Settings.tsx frontend/src/services/socket.ts
git commit -m "Bump agent-count copy from 13 to 14 for the new Quant Forecaster agent"
```

---

## Task 7: Node — `KRONOS_SERVICE_URL` env wiring and settings docs

**Files:**
- Modify: `apex-trader/backend/.env.example` (or create it if it doesn't already exist — check first)
- Modify: `apex-trader/backend/src/routes/settings.ts` (or wherever `/api/settings` currently exposes configured env-derived values — grep for where `DAILY_LOSS_LIMIT_PCT` or similar is surfaced, and add `kronosServiceConfigured: boolean` alongside it, matching the existing style)

**Interfaces:**
- Consumes: `process.env.KRONOS_SERVICE_URL` (Task 4 already reads this at call time).
- Produces: `/api/settings` response gains `kronosServiceConfigured: !!process.env.KRONOS_SERVICE_URL` so the dashboard can show whether the forecaster is wired up, rather than only discovering it's silently `null` mid-debate.

- [ ] **Step 1: Check for `.env.example` and add the new var**

Run: `cd apex-trader/backend && ls -la .env.example 2>/dev/null || echo "no .env.example"`. If it exists, add a line:
```
KRONOS_SERVICE_URL=http://kronos-service.railway.internal:8000
```
If it doesn't exist, skip this step — don't invent a new file convention the project doesn't already use.

- [ ] **Step 2: Grep for the existing settings-exposure route**

Run: `cd apex-trader/backend && grep -rn "DAILY_LOSS_LIMIT_PCT" src/routes/`. Read the matched file to find the exact shape of the response object.

- [ ] **Step 3: Add the field**

Add `kronosServiceConfigured: !!process.env.KRONOS_SERVICE_URL` to that same response object, following the exact style of the other env-derived fields already there (e.g. if they're all inside a `data: {...}` object, add it there, not at the top level).

- [ ] **Step 4: Manual verification**

Call the settings endpoint with a valid JWT (with `KRONOS_SERVICE_URL` unset locally) and confirm `kronosServiceConfigured: false` appears in the response — confirms the field is wired without needing the real service running.

- [ ] **Step 5: Commit**

```bash
cd apex-trader
git add backend/.env.example backend/src/routes/settings.ts
git commit -m "Expose kronosServiceConfigured in /api/settings

Lets the dashboard show whether the Quant Forecaster's backing service is
wired up, instead of only discovering a silent null mid-debate."
```

---

## Task 8: Manual live end-to-end verification

**Files:** none (verification-only task, no code changes).

- [ ] **Step 1: Deploy and verify**

With the Kronos service deployed (Task 3) and `KRONOS_SERVICE_URL` set on the Node backend, run one real debate end-to-end on a real symbol (via the existing Agent Council manual-trigger path documented in project memory: `/agents/run-and-trade`). Confirm:
- The Quant Forecaster (agent 14) appears in the round-1 results with a real vote/confidence, not the `HOLD`/0%-confidence fallback used when an agent's call throws.
- The logged round-1 prompt (temporarily log the assembled `round1Prompt` once, per the existing project convention of verifying prompt assembly by logging it rather than trusting the DB query alone) contains a `── QUANT FORECAST (Kronos ML model) ──` section with real numbers, not an empty string.
- `GET /api/settings` shows `kronosServiceConfigured: true` in this environment.

- [ ] **Step 2: Record the outcome**

No commit for this task (verification only) — note the result in the plan's tracking (progress ledger, if executed via subagent-driven-development) so the final whole-branch review knows this was confirmed live, not just unit-tested.
