# apex-trader/kronos-service/forecast.py
import pandas as pd
import numpy as np

# The platform validator (backend/src/services/kronosService.ts) requires
# every returned value to be a positive, finite price. The vendored model's
# denormalization (preds * x_std + x_mean in kronos_lib) is affine and
# unclamped, so a sampled path can dip to/below zero even though a price
# cannot. Floor sampled closes at a tiny positive epsilon: economically
# "crashed to zero", numerically a valid positive price.
_CLOSE_FLOOR = 1e-6

# Ensemble band quantiles — the quantile analogue of the old mean ± 1σ band
# (≈16th–84th percentile of a normal distribution).
_BAND_Q_LOW = 0.16
_BAND_Q_HIGH = 0.84


def _normalize_run(closes, pred_len: int) -> np.ndarray:
    """Force one ensemble run to exactly pred_len finite, positive closes.

    Row-count behavior of the vendored library, verified in
    kronos_lib/model/kronos.py: KronosPredictor.generate() slices the
    autoregressive output to the last pred_len steps
    (``preds[:, -pred_len:, :]``) and predict() builds its DataFrame on the
    y_timestamp index the caller passed (itself pred_len long), so with the
    vendored build predict() already returns exactly pred_len rows. This
    normalization is the contract guard the old code lacked: it previously
    passed through whatever length came back, so any predictor whose row
    count drifted (or runs of differing lengths, which also crashed the
    np.array stacking) silently produced a response the platform validator
    rejects on length. Extra rows are truncated; a short run is extended
    flat with its own final value; an empty or non-finite run is a hard
    error rather than a fabricated or contract-violating forecast.
    """
    closes = np.asarray(closes, dtype=float)
    if closes.size == 0:
        raise ValueError("predict() returned no rows")
    if len(closes) > pred_len:
        closes = closes[:pred_len]
    elif len(closes) < pred_len:
        closes = np.concatenate(
            [closes, np.full(pred_len - len(closes), closes[-1])]
        )
    if not np.all(np.isfinite(closes)):
        raise ValueError("predict() returned non-finite closes")
    return np.clip(closes, _CLOSE_FLOOR, None)


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
    # and aggregating across runs is how we get a real confidence band
    # without forking the vendored library.
    close_runs = []
    for _ in range(ensemble_size):
        pred_df = predictor.predict(
            df[["open", "high", "low", "close", "volume"]], x_timestamp, y_timestamp, pred_len,
            T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=False,
        )
        close_runs.append(_normalize_run(pred_df["close"].to_numpy(), pred_len))

    close_matrix = np.stack(close_runs)  # shape (ensemble_size, pred_len)
    mean_close = close_matrix.mean(axis=0)

    # Bands from ensemble quantiles, NOT mean ± std. At T=1.0 the sampled
    # runs diverge hard (a few paths can crash toward zero while others sit
    # at the last close), and whenever std >= mean the old lowerBand went
    # to/below zero — the platform validator requires positive prices and
    # rejected every such response (the production failure behind the
    # Quant Forecaster's permanent HOLD at confidence 0). Quantiles of
    # positive closes are themselves positive and ordered by construction.
    # The min/max envelope against the mean additionally guarantees
    # lowerBand <= predictedClose <= upperBand even for skewed ensembles
    # whose mean falls outside the quantile range.
    lower_band = np.minimum(
        np.quantile(close_matrix, _BAND_Q_LOW, axis=0), mean_close
    )
    upper_band = np.maximum(
        np.quantile(close_matrix, _BAND_Q_HIGH, axis=0), mean_close
    )

    last_close = float(df["close"].iloc[-1])
    # meanReturn is computed from the exact predictedClose values returned
    # below — the platform recomputes it from the response body and demands
    # agreement to within 1e-8.
    mean_return = float((mean_close[-1] - last_close) / last_close)

    return {
        "predictedClose": mean_close.tolist(),
        "upperBand": upper_band.tolist(),
        "lowerBand": lower_band.tolist(),
        "meanReturn": mean_return,
    }
