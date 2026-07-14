# apex-trader/kronos-service/model_loader.py
import logging
import os
import sys

# The vendored kronos_lib/model/kronos.py does `sys.path.append("../")` then
# `from model.module import *` — a relative-to-CWD hack from the original
# repo's own layout that breaks regardless of CWD once vendored under
# kronos_lib/. Fixed here (our wrapper, not the vendored file) by putting
# kronos_lib/ itself on sys.path, so kronos.py's unqualified `import model`
# resolves to kronos_lib/model regardless of where this process is run from.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "kronos_lib"))

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
