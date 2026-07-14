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


if __name__ == "__main__":
    model_loader.get_predictor()  # load at boot, not on first request
    app.run(host="0.0.0.0", port=int(__import__("os").environ.get("PORT", "8000")))
