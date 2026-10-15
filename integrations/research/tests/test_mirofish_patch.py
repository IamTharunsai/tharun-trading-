import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from patch_mirofish import ORIGINAL, REPLACEMENT, patch_logger


class PinnedLoggerPatch(unittest.TestCase):
    def test_replaces_only_exact_assignment_and_preserves_surroundings(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "logger.py"
            path.write_text("import os\n" + ORIGINAL + "\nlogger = setup_logger()\n")
            patch_logger(path)
            self.assertEqual(path.read_text(), "import os\n" + REPLACEMENT + "\nlogger = setup_logger()\n")

    def test_changed_duplicate_and_already_patched_source_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "logger.py"
            for source in ("LOG_DIR = 'different'", ORIGINAL + "\n" + ORIGINAL,
                           ORIGINAL + "\n" + REPLACEMENT, REPLACEMENT):
                path.write_text(source)
                with self.assertRaises(ValueError):
                    patch_logger(path)
                self.assertEqual(path.read_text(), source)
