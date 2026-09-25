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
