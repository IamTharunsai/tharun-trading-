"""Narrow deployment patch for the pinned upstream import-time log path.

Keep the engine read-only at runtime. The gateway supplies a private job path
before any upstream import, including the OASIS subprocess. Fail the image
build if the pinned source contract changes instead of applying a loose patch.
"""
from pathlib import Path
import sys

ORIGINAL = "LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'logs')"
REPLACEMENT = 'LOG_DIR = os.environ["MIROFISH_LOG_DIR"]'


def patch_logger(path):
    source = path.read_text(encoding="utf-8")
    if source.count(ORIGINAL) != 1 or REPLACEMENT in source:
        raise ValueError("pinned_logger_contract_changed")
    path.write_text(source.replace(ORIGINAL, REPLACEMENT), encoding="utf-8")


if __name__ == "__main__":
    patch_logger(Path(sys.argv[1]))
