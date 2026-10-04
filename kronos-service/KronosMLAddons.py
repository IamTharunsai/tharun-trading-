"""
KRONOS ML ADDONS
═══════════════════════════════════════════════════════════════════════════════
Advanced ML capabilities for APEX trading platform.
Integrates best-in-class open-source financial ML libraries:

  /sentiment       — FinBERT financial news sentiment (ProsusAI)
  /indicators      — pandas-ta: 130+ technical indicators batch API
  /ml-forecast     — Neuralforecast NHITS time-series price prediction
  /portfolio/optimize — PyPortfolioOpt: efficient frontier + HRP weights
  /metrics/advanced   — empyrical: Sharpe, Sortino, Calmar, alpha/beta

All endpoints accept POST JSON and return JSON.
Called by Node.js backend via HTTP.

Legal note: All strategies use only public market data. No insider
information is used. All activities comply with applicable regulations.
"""

from flask import Blueprint, request, jsonify
import numpy as np
import pandas as pd
import logging
import traceback
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

ml_addons_bp = Blueprint('ml_addons', __name__)


# ─── LAZY IMPORTS ─────────────────────────────────────────────────────────────
# Loaded on first use to avoid startup failures if a library isn't installed.

_finbert_pipeline = None
_pandas_ta_available = False
_empyrical_available = False
_pypfopt_available = False
_neuralforecast_available = False


def _load_finbert():
    """Load FinBERT model (first call only — cached after that)."""
    global _finbert_pipeline
    if _finbert_pipeline is not None:
        return _finbert_pipeline, None
    try:
        from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
        tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
        model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        _finbert_pipeline = pipeline(
            "text-classification",
            model=model,
            tokenizer=tokenizer,
            top_k=None,   # Return all 3 label scores
            truncation=True,
            max_length=512,
        )
        logger.info("[ML] FinBERT loaded successfully")
        return _finbert_pipeline, None
    except Exception as e:
        logger.warning(f"[ML] FinBERT not available: {e}")
        return None, str(e)


def _check_pandas_ta():
    global _pandas_ta_available
    if not _pandas_ta_available:
        try:
            import pandas_ta  # noqa
            _pandas_ta_available = True
        except ImportError:
            pass
    return _pandas_ta_available


def _check_empyrical():
    global _empyrical_available
    if not _empyrical_available:
        try:
            import empyrical  # noqa
            _empyrical_available = True
        except ImportError:
            pass
    return _empyrical_available


def _check_pypfopt():
    global _pypfopt_available
    if not _pypfopt_available:
        try:
            import pypfopt  # noqa
            _pypfopt_available = True
        except ImportError:
            pass
    return _pypfopt_available


def _check_neuralforecast():
    global _neuralforecast_available
    if not _neuralforecast_available:
        try:
            import neuralforecast  # noqa
            _neuralforecast_available = True
        except ImportError:
            pass
    return _neuralforecast_available


# ─── /sentiment ────────────────────────────────────────────────────────────────

@ml_addons_bp.route('/sentiment', methods=['POST'])
def sentiment():
    """
    FinBERT financial news sentiment analysis.

    Request:  { "texts": ["Apple beats Q3 earnings", "Fed hikes rates by 75bp"] }
    Response: { "results": [{ "text": "...", "label": "positive", "score": 0.94,
                               "positive": 0.94, "neutral": 0.04, "negative": 0.02 }] }

    Labels: positive | neutral | negative
    Use case: Score news headlines for trading signal enhancement.
    """
    data = request.get_json(force=True, silent=True) or {}
    texts: List[str] = data.get('texts', [])

    if not texts:
        return jsonify({'error': 'texts array required'}), 400
    if len(texts) > 100:
        return jsonify({'error': 'max 100 texts per call'}), 400

    pipeline_fn, err = _load_finbert()

    if pipeline_fn is None:
        # Graceful fallback: simple keyword-based sentiment
        logger.warning("[ML] FinBERT unavailable — using keyword fallback")
        results = []
        for text in texts:
            t = text.lower()
            pos_kw = ['beat', 'surge', 'gain', 'profit', 'growth', 'rally', 'strong', 'exceed', 'record', 'upgrade']
            neg_kw = ['miss', 'decline', 'loss', 'fall', 'drop', 'weak', 'cut', 'downgrade', 'concern', 'risk']
            pos_hits = sum(1 for k in pos_kw if k in t)
            neg_hits = sum(1 for k in neg_kw if k in t)
            if pos_hits > neg_hits:
                label, score = 'positive', min(0.5 + pos_hits * 0.08, 0.90)
            elif neg_hits > pos_hits:
                label, score = 'negative', min(0.5 + neg_hits * 0.08, 0.90)
            else:
                label, score = 'neutral', 0.60
            results.append({
                'text': text[:120],
                'label': label,
                'score': round(score, 4),
                'positive': round(score if label == 'positive' else (1 - score) * 0.3, 4),
                'neutral':  round(score if label == 'neutral'  else (1 - score) * 0.4, 4),
                'negative': round(score if label == 'negative' else (1 - score) * 0.3, 4),
                'fallback': True,
                'fallbackReason': err,
            })
        return jsonify({'results': results, 'model': 'keyword-fallback'})

    try:
        raw_results = pipeline_fn(texts, batch_size=16)
        results = []
        for text, preds in zip(texts, raw_results):
            scores = {p['label'].lower(): p['score'] for p in preds}
            best = max(preds, key=lambda x: x['score'])
            results.append({
                'text': text[:120],
                'label': best['label'].lower(),
                'score': round(best['score'], 4),
                'positive': round(scores.get('positive', 0), 4),
                'neutral':  round(scores.get('neutral',  0), 4),
                'negative': round(scores.get('negative', 0), 4),
                'fallback': False,
            })
        return jsonify({'results': results, 'model': 'ProsusAI/finbert'})

    except Exception as e:
        logger.error(f"[ML] FinBERT inference error: {e}")
        return jsonify({'error': str(e)}), 500


# ─── /indicators ──────────────────────────────────────────────────────────────

@ml_addons_bp.route('/indicators', methods=['POST'])
def indicators():
    """
    pandas-ta batch technical indicator calculation.

    Request:
      {
        "ohlcv": [
          { "timestamp": 1700000000000, "open": 100, "high": 105,
            "low": 98, "close": 103, "volume": 1500000 },
          ...
        ],
        "indicators": ["rsi", "macd", "bbands", "atr", "obv", "ema_20", "sma_50"]
        // or "all" for complete set
      }

    Response: { "results": { "rsi_14": [...], "macd": {...}, ... }, "bars": N }

    Indicator list (subset — 130+ available via pandas-ta):
      rsi, macd, bbands, atr, obv, ema_20, ema_50, sma_20, sma_50, sma_200,
      stoch, adx, cci, williams_r, mfi, vwap, ichimoku, supertrend, kc, donchian
    """
    data = request.get_json(force=True, silent=True) or {}
    ohlcv: List[Dict] = data.get('ohlcv', [])
    requested: Any = data.get('indicators', 'common')

    if len(ohlcv) < 2:
        return jsonify({'error': 'At least 2 OHLCV bars required'}), 400

    if not _check_pandas_ta():
        return jsonify({'error': 'pandas-ta not installed', 'install': 'pip install pandas-ta'}), 503

    import pandas_ta as ta

    try:
        df = pd.DataFrame(ohlcv)
        df.rename(columns={
            'timestamp': 'date', 'open': 'open', 'high': 'high',
            'low': 'low', 'close': 'close', 'volume': 'volume'
        }, inplace=True)
        df['date'] = pd.to_datetime(df['date'], unit='ms')
        df.set_index('date', inplace=True)
        df = df[['open', 'high', 'low', 'close', 'volume']].astype(float)

        results: Dict[str, Any] = {}

        def safe_series(s) -> List:
            if s is None:
                return []
            return [None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 6)
                    for v in s]

        # Determine what to compute
        compute_all = requested == 'all'
        req_set = set(requested) if isinstance(requested, list) else set()

        def wants(name: str) -> bool:
            return compute_all or name in req_set

        if wants('rsi') or requested == 'common':
            results['rsi_14'] = safe_series(ta.rsi(df['close'], length=14))

        if wants('macd') or requested == 'common':
            macd = ta.macd(df['close'])
            if macd is not None:
                results['macd'] = safe_series(macd.iloc[:, 0])
                results['macd_signal'] = safe_series(macd.iloc[:, 1])
                results['macd_hist'] = safe_series(macd.iloc[:, 2])

        if wants('bbands') or requested == 'common':
            bb = ta.bbands(df['close'])
            if bb is not None:
                results['bb_upper'] = safe_series(bb.iloc[:, 0])
                results['bb_mid']   = safe_series(bb.iloc[:, 1])
                results['bb_lower'] = safe_series(bb.iloc[:, 2])
                results['bb_pct_b'] = safe_series(bb.iloc[:, 4] if bb.shape[1] > 4 else None)

        if wants('atr') or requested == 'common':
            results['atr_14'] = safe_series(ta.atr(df['high'], df['low'], df['close'], length=14))

        if wants('obv') or requested == 'common':
            results['obv'] = safe_series(ta.obv(df['close'], df['volume']))

        if wants('ema_20') or requested == 'common':
            results['ema_20'] = safe_series(ta.ema(df['close'], length=20))

        if wants('ema_50'):
            results['ema_50'] = safe_series(ta.ema(df['close'], length=50))

        if wants('sma_20'):
            results['sma_20'] = safe_series(ta.sma(df['close'], length=20))

        if wants('sma_50'):
            results['sma_50'] = safe_series(ta.sma(df['close'], length=50))

        if wants('sma_200'):
            results['sma_200'] = safe_series(ta.sma(df['close'], length=200))

        if wants('stoch'):
            stoch = ta.stoch(df['high'], df['low'], df['close'])
            if stoch is not None:
                results['stoch_k'] = safe_series(stoch.iloc[:, 0])
                results['stoch_d'] = safe_series(stoch.iloc[:, 1])

        if wants('adx'):
            adx = ta.adx(df['high'], df['low'], df['close'])
            if adx is not None:
                results['adx']    = safe_series(adx.iloc[:, 0])
                results['adx_di_plus']  = safe_series(adx.iloc[:, 1])
                results['adx_di_minus'] = safe_series(adx.iloc[:, 2])

        if wants('cci'):
            results['cci_20'] = safe_series(ta.cci(df['high'], df['low'], df['close'], length=20))

        if wants('williams_r'):
            results['williams_r'] = safe_series(ta.willr(df['high'], df['low'], df['close']))

        if wants('mfi'):
            results['mfi_14'] = safe_series(ta.mfi(df['high'], df['low'], df['close'], df['volume'], length=14))

        if wants('vwap'):
            results['vwap'] = safe_series(ta.vwap(df['high'], df['low'], df['close'], df['volume']))

        if wants('supertrend'):
            st = ta.supertrend(df['high'], df['low'], df['close'])
            if st is not None:
                results['supertrend'] = safe_series(st.iloc[:, 0])
                results['supertrend_dir'] = safe_series(st.iloc[:, 1])

        if wants('kc'):
            kc = ta.kc(df['high'], df['low'], df['close'])
            if kc is not None:
                results['kc_upper']  = safe_series(kc.iloc[:, 0])
                results['kc_basis']  = safe_series(kc.iloc[:, 1])
                results['kc_lower']  = safe_series(kc.iloc[:, 2])

        if wants('donchian'):
            dc = ta.donchian(df['high'], df['low'])
            if dc is not None:
                results['donchian_upper'] = safe_series(dc.iloc[:, 0])
                results['donchian_mid']   = safe_series(dc.iloc[:, 1])
                results['donchian_lower'] = safe_series(dc.iloc[:, 2])

        # Add timestamps
        results['timestamps'] = [int(ts.timestamp() * 1000) for ts in df.index]

        return jsonify({
            'results': results,
            'bars': len(df),
            'indicators_computed': len([k for k in results if k != 'timestamps']),
        })

    except Exception as e:
        logger.error(f"[ML] indicators error: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500


# ─── /ml-forecast ─────────────────────────────────────────────────────────────

@ml_addons_bp.route('/ml-forecast', methods=['POST'])
def ml_forecast():
    """
    Time-series price forecasting using Neuralforecast NHITS or statistical fallback.

    Request:
      {
        "series": [
          { "timestamp": 1700000000000, "close": 103.5 },
          ...  (min 30 bars recommended)
        ],
        "horizon": 5,         // Bars ahead to forecast (default: 5)
        "symbol": "AAPL",
        "method": "nhits"     // "nhits" | "autoarima" | "ets" (fallback)
      }

    Response:
      {
        "forecast": [
          { "timestamp": ..., "yhat": 105.2, "yhat_lo": 102.1, "yhat_hi": 108.3 }
        ],
        "model": "NHITS",
        "mape": 0.023,         // In-sample MAPE
        "direction": "UP"       // Expected price direction
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    series: List[Dict] = data.get('series', [])
    horizon: int = min(int(data.get('horizon', 5)), 30)
    symbol: str = data.get('symbol', 'UNKNOWN')
    method: str = data.get('method', 'nhits')

    if len(series) < 10:
        return jsonify({'error': 'At least 10 data points required'}), 400

    try:
        # Build series
        closes = np.array([float(p['close']) for p in series])
        timestamps_ms = [int(p['timestamp']) for p in series]

        # Always available: statistical fallback models
        if method in ('autoarima', 'ets') or not _check_neuralforecast():
            return _statistical_forecast(closes, timestamps_ms, horizon, symbol)

        # Try Neuralforecast NHITS
        try:
            from neuralforecast import NeuralForecast
            from neuralforecast.models import NHITS
            import warnings
            warnings.filterwarnings('ignore')

            freq_ms = int(np.median(np.diff(timestamps_ms)))
            freq_pd = _infer_pandas_freq(freq_ms)

            df_nf = pd.DataFrame({
                'unique_id': symbol,
                'ds': pd.to_datetime(timestamps_ms, unit='ms'),
                'y': closes,
            })

            model = NHITS(
                h=horizon,
                input_size=min(len(closes) - horizon, 48),
                max_steps=50,     # Fast training
                scaler_type='standard',
            )
            nf = NeuralForecast(models=[model], freq=freq_pd)
            nf.fit(df_nf)
            forecast_df = nf.predict()

            last_ts = timestamps_ms[-1]
            forecast_list = []
            for i in range(horizon):
                next_ts = last_ts + freq_ms * (i + 1)
                yhat = float(forecast_df['NHITS'].iloc[i]) if i < len(forecast_df) else closes[-1]
                forecast_list.append({
                    'timestamp': next_ts,
                    'yhat': round(yhat, 4),
                    'yhat_lo': round(yhat * 0.97, 4),  # ±3% confidence
                    'yhat_hi': round(yhat * 1.03, 4),
                })

            direction = 'UP' if forecast_list[-1]['yhat'] > closes[-1] else 'DOWN'
            chg_pct = (forecast_list[-1]['yhat'] - closes[-1]) / closes[-1] * 100

            return jsonify({
                'forecast': forecast_list,
                'model': 'NHITS',
                'direction': direction,
                'expectedChangePct': round(chg_pct, 2),
                'inputBars': len(closes),
                'horizon': horizon,
                'symbol': symbol,
            })

        except Exception as e:
            logger.warning(f"[ML] NHITS failed, falling back to statistical: {e}")
            return _statistical_forecast(closes, timestamps_ms, horizon, symbol)

    except Exception as e:
        logger.error(f"[ML] ml-forecast error: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500


def _infer_pandas_freq(freq_ms: int) -> str:
    """Infer pandas frequency string from milliseconds between bars."""
    if freq_ms <= 60_000: return 'T'           # 1min
    if freq_ms <= 300_000: return '5T'          # 5min
    if freq_ms <= 900_000: return '15T'         # 15min
    if freq_ms <= 3_600_000: return 'H'         # 1hr
    if freq_ms <= 86_400_000: return 'D'        # 1day
    if freq_ms <= 604_800_000: return 'W'       # 1week
    return 'D'


def _statistical_forecast(closes: np.ndarray, timestamps_ms: List[int], horizon: int, symbol: str) -> Any:
    """Simple statistical forecast fallback when ML models aren't available."""
    from flask import jsonify
    n = len(closes)
    freq_ms = int(np.median(np.diff(timestamps_ms))) if len(timestamps_ms) > 1 else 86_400_000

    # Linear trend + seasonal decomposition
    x = np.arange(n)
    coeffs = np.polyfit(x, closes, 1)
    trend_slope = coeffs[0]

    # Volatility estimate (20-bar)
    returns = np.diff(closes) / closes[:-1]
    vol = float(np.std(returns[-20:])) if len(returns) >= 20 else float(np.std(returns))

    last_ts = timestamps_ms[-1]
    last_price = closes[-1]

    forecast_list = []
    for i in range(1, horizon + 1):
        yhat = last_price + trend_slope * i
        ci = yhat * vol * np.sqrt(i) * 1.96
        forecast_list.append({
            'timestamp': last_ts + freq_ms * i,
            'yhat': round(float(yhat), 4),
            'yhat_lo': round(float(yhat - ci), 4),
            'yhat_hi': round(float(yhat + ci), 4),
        })

    direction = 'UP' if trend_slope > 0 else 'DOWN'
    chg_pct = trend_slope * horizon / last_price * 100

    return jsonify({
        'forecast': forecast_list,
        'model': 'LinearTrend+Vol',
        'direction': direction,
        'expectedChangePct': round(float(chg_pct), 2),
        'annualizedVol': round(float(vol * np.sqrt(252)), 4),
        'inputBars': n,
        'horizon': horizon,
        'symbol': symbol,
        'fallback': True,
    })


# ─── /portfolio/optimize ───────────────────────────────────────────────────────

@ml_addons_bp.route('/portfolio/optimize', methods=['POST'])
def portfolio_optimize():
    """
    Portfolio optimization via PyPortfolioOpt.

    Request:
      {
        "returns": {
          "AAPL": [0.01, -0.02, 0.015, ...],   // Daily returns per asset
          "MSFT": [0.005, 0.02, -0.01, ...],
          "GOOGL": [...]
        },
        "method": "max_sharpe",  // max_sharpe | min_vol | max_quadratic_utility | hrp | equal
        "risk_free_rate": 0.04,  // Annual risk-free rate (default: 4%)
        "target_return": null,   // Only for efficient_return method
        "constraints": {
          "long_only": true,     // Default true (no shorts)
          "min_weight": 0.0,
          "max_weight": 0.40,    // Max 40% in any single asset
        }
      }

    Response:
      {
        "weights": { "AAPL": 0.35, "MSFT": 0.40, "GOOGL": 0.25 },
        "performance": {
          "expectedReturn": 0.182,
          "annualizedVol": 0.187,
          "sharpeRatio": 0.74
        },
        "method": "max_sharpe"
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    returns_dict: Dict[str, List[float]] = data.get('returns', {})
    method: str = data.get('method', 'max_sharpe')
    risk_free: float = float(data.get('risk_free_rate', 0.04))
    constraints: Dict = data.get('constraints', {})

    if len(returns_dict) < 2:
        return jsonify({'error': 'At least 2 assets required'}), 400

    # Equal-weight fallback (always works)
    if method == 'equal' or not _check_pypfopt():
        n = len(returns_dict)
        weights = {asset: round(1 / n, 4) for asset in returns_dict}
        ret_arr = np.array(list(returns_dict.values()))
        exp_ret = float(np.mean(ret_arr) * 252)
        cov = np.cov(ret_arr)
        w = np.array([1/n] * n)
        port_vol = float(np.sqrt(w @ cov @ w) * np.sqrt(252))
        sharpe = (exp_ret - risk_free) / port_vol if port_vol > 0 else 0

        return jsonify({
            'weights': weights,
            'performance': {
                'expectedReturn': round(exp_ret, 4),
                'annualizedVol': round(port_vol, 4),
                'sharpeRatio': round(sharpe, 4),
            },
            'method': 'equal_weight',
            'fallback': not _check_pypfopt(),
        })

    try:
        from pypfopt import EfficientFrontier, risk_models, expected_returns
        from pypfopt.hierarchical_portfolio import HRPOpt

        returns_df = pd.DataFrame(returns_dict)

        # Compute expected returns and covariance
        mu = expected_returns.mean_historical_return(returns_df, returns_data=True, compounding=True)
        S = risk_models.sample_cov(returns_df, returns_data=True)

        long_only: bool = constraints.get('long_only', True)
        min_w: float = float(constraints.get('min_weight', 0.0))
        max_w: float = float(constraints.get('max_weight', 0.40))

        if method == 'hrp':
            # Hierarchical Risk Parity — no mean estimates needed
            hrp = HRPOpt(returns=returns_df)
            hrp.optimize()
            cleaned_weights = hrp.clean_weights()
            perf = hrp.portfolio_performance(risk_free_rate=risk_free, verbose=False)

        else:
            weight_bounds = (min_w, max_w) if long_only else (-max_w, max_w)
            ef = EfficientFrontier(mu, S, weight_bounds=weight_bounds)

            if method == 'max_sharpe':
                ef.max_sharpe(risk_free_rate=risk_free)
            elif method == 'min_vol':
                ef.min_volatility()
            elif method == 'max_quadratic_utility':
                ef.max_quadratic_utility(risk_aversion=2.0)
            elif method == 'efficient_return' and data.get('target_return') is not None:
                ef.efficient_return(float(data['target_return']))
            else:
                ef.max_sharpe(risk_free_rate=risk_free)

            cleaned_weights = ef.clean_weights()
            perf = ef.portfolio_performance(risk_free_rate=risk_free, verbose=False)

        return jsonify({
            'weights': {k: round(float(v), 4) for k, v in cleaned_weights.items() if float(v) > 0.001},
            'performance': {
                'expectedReturn': round(float(perf[0]), 4),
                'annualizedVol':  round(float(perf[1]), 4),
                'sharpeRatio':    round(float(perf[2]), 4),
            },
            'method': method,
            'assetsOptimized': len(cleaned_weights),
        })

    except Exception as e:
        logger.error(f"[ML] portfolio optimize error: {traceback.format_exc()}")
        # Fallback to equal weight
        n = len(returns_dict)
        return jsonify({
            'weights': {asset: round(1/n, 4) for asset in returns_dict},
            'performance': {'expectedReturn': None, 'annualizedVol': None, 'sharpeRatio': None},
            'method': 'equal_weight_fallback',
            'error': str(e),
        })


# ─── /metrics/advanced ─────────────────────────────────────────────────────────

@ml_addons_bp.route('/metrics/advanced', methods=['POST'])
def advanced_metrics():
    """
    Advanced portfolio performance metrics via empyrical.

    Request:
      {
        "returns": [0.01, -0.005, 0.02, ...],     // Daily portfolio returns
        "benchmark": [0.008, -0.003, 0.015, ...],  // Optional benchmark returns (e.g. SPY)
        "risk_free": 0.04,                          // Annual risk-free rate
        "period": "daily"                           // daily | weekly | monthly
      }

    Response:
      {
        "sharpe": 1.42,
        "sortino": 1.87,
        "calmar": 0.93,
        "maxDrawdown": -0.147,
        "annualReturn": 0.23,
        "annualVol": 0.16,
        "alpha": 0.04,
        "beta": 0.87,
        "informationRatio": 0.61,
        "cvar": -0.028,
        "var95": -0.019,
        "skewness": 0.23,
        "kurtosis": 1.1,
        "winRate": 0.54,
        "avgWin": 0.012,
        "avgLoss": -0.008,
        "profitFactor": 1.65,
        "expectancy": 0.003
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    returns: List[float] = data.get('returns', [])
    benchmark: Optional[List[float]] = data.get('benchmark', None)
    risk_free: float = float(data.get('risk_free', 0.04))
    period: str = data.get('period', 'daily')

    if len(returns) < 5:
        return jsonify({'error': 'At least 5 return observations required'}), 400

    r = np.array(returns, dtype=float)
    b = np.array(benchmark, dtype=float) if benchmark else None

    try:
        if _check_empyrical():
            import empyrical as ep

            result = {
                'sharpe':      _safe_float(ep.sharpe_ratio(r, risk_free=risk_free/252, period=period)),
                'sortino':     _safe_float(ep.sortino_ratio(r, required_return=risk_free/252, period=period)),
                'calmar':      _safe_float(ep.calmar_ratio(r, period=period)),
                'maxDrawdown': _safe_float(ep.max_drawdown(r)),
                'annualReturn': _safe_float(ep.annual_return(r, period=period)),
                'annualVol':   _safe_float(ep.annual_volatility(r, period=period)),
                'model':       'empyrical',
            }
            if b is not None and len(b) == len(r):
                result['alpha'] = _safe_float(ep.alpha(r, b, risk_free=risk_free/252, period=period))
                result['beta']  = _safe_float(ep.beta(r, b))
        else:
            # Pure numpy fallback
            annual_factor = {'daily': 252, 'weekly': 52, 'monthly': 12}.get(period, 252)
            result = {
                'annualReturn': _safe_float(np.mean(r) * annual_factor),
                'annualVol':    _safe_float(np.std(r) * np.sqrt(annual_factor)),
                'model':        'numpy-fallback',
            }
            vol = result['annualVol']
            ret = result['annualReturn']
            result['sharpe'] = _safe_float((ret - risk_free) / vol) if vol else None
            # Max drawdown via cumulative returns
            cum = np.cumprod(1 + r)
            roll_max = np.maximum.accumulate(cum)
            dd = (cum - roll_max) / roll_max
            result['maxDrawdown'] = _safe_float(np.min(dd))

        # Additional stats (always computed from numpy — no empyrical needed)
        wins = r[r > 0]
        losses = r[r < 0]
        result.update({
            'cvar':          _safe_float(-np.percentile(r, 5) if len(r) > 0 else None),
            'var95':         _safe_float(-np.percentile(r, 5)),
            'skewness':      _safe_float(float(_skewness(r))),
            'kurtosis':      _safe_float(float(_kurtosis(r))),
            'winRate':       _safe_float(len(wins) / len(r) if len(r) > 0 else None),
            'avgWin':        _safe_float(float(np.mean(wins)) if len(wins) > 0 else 0),
            'avgLoss':       _safe_float(float(np.mean(losses)) if len(losses) > 0 else 0),
            'profitFactor':  _safe_float(
                abs(np.sum(wins) / np.sum(losses))
                if len(losses) > 0 and np.sum(losses) != 0 else None
            ),
            'expectancy':    _safe_float(float(np.mean(r))),
            'observations':  len(r),
        })

        return jsonify(result)

    except Exception as e:
        logger.error(f"[ML] advanced metrics error: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500


def _safe_float(v) -> Optional[float]:
    """Convert to float, returning None for NaN/Inf."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 6)
    except Exception:
        return None


def _skewness(r: np.ndarray) -> float:
    mu = np.mean(r)
    sigma = np.std(r)
    if sigma == 0:
        return 0.0
    return float(np.mean(((r - mu) / sigma) ** 3))


def _kurtosis(r: np.ndarray) -> float:
    mu = np.mean(r)
    sigma = np.std(r)
    if sigma == 0:
        return 0.0
    return float(np.mean(((r - mu) / sigma) ** 4) - 3)


# ─── /ml-health ───────────────────────────────────────────────────────────────

@ml_addons_bp.route('/ml-health', methods=['GET'])
def ml_health():
    """Check which ML libraries are available."""
    _, finbert_err = _load_finbert()
    return jsonify({
        'finbert': finbert_err is None,
        'finbert_error': finbert_err,
        'pandas_ta': _check_pandas_ta(),
        'empyrical': _check_empyrical(),
        'pypfopt':   _check_pypfopt(),
        'neuralforecast': _check_neuralforecast(),
        'status': 'ok',
        'timestamp': datetime.utcnow().isoformat(),
    })
