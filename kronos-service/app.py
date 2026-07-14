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
