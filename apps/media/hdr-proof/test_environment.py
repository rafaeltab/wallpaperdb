"""The proof environment rejects missing, altered, or ambiguous native locks."""

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


INSTALLER = Path(__file__).parent / "environment" / "install-apk.cjs"


class EnvironmentTests(unittest.TestCase):
    def verify(self, archive, expected_archive, duplicate=False):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            entry = {
                "name": "proof-test", "version": "1-r0",
                "source": "apk_archive",
                "url": "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/proof-test-1-r0.apk",
                "bytes": len(expected_archive),
                "sha256": hashlib.sha256(expected_archive).hexdigest(),
            }
            manifest = directory / "apk-lock.json"
            manifest.write_text(json.dumps({"schema_version": 1, "platform": "linux/amd64",
                                             "packages": [entry, entry] if duplicate else [entry]}))
            if archive is not None:
                (directory / "proof-test-1-r0.apk").write_bytes(archive)
            return subprocess.run(["node", str(INSTALLER), str(manifest), str(directory),
                                   "--verify-only"], capture_output=True, text=True)

    def test_altered_archive_is_rejected_before_installation(self):
        result = self.verify(b"altered", b"correct")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)

    def test_missing_archive_is_not_treated_as_verified(self):
        result = self.verify(None, b"correct")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ENOENT", result.stderr)

    def test_exact_archive_verifies_without_network_or_installing(self):
        result = self.verify(b"correct", b"correct")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verified 1 exact APK archives", result.stdout)

    def test_conflicting_duplicate_dependency_is_rejected(self):
        result = self.verify(b"correct", b"correct", duplicate=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate", result.stderr)


if __name__ == "__main__":
    unittest.main()
