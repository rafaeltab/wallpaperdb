"""Byte verification for the qualified #557 Boat CLI. No runtime pin override."""

import hashlib
import os
from pathlib import Path
import stat
import sys


QUALIFIED_SHA256 = "5d7933a238dcea0446bbbee0e2506692961d16537b9960003e4ece9ecb1ec498"


def verify_artifact(path, expected_sha256):
    path = Path(path)
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Boat artifact must be a regular file: {path}")
    # Do not follow a replaced symlink or block on a replaced FIFO at open.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError(f"Boat artifact must be a regular file: {path}")
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != expected_sha256:
        raise ValueError(
            f"Boat artifact checksum mismatch: {path}; expected {expected_sha256}, "
            f"got {actual}. Retain the qualified 1.0.85 binary or requalify before cohorts"
        )


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Usage: boat-artifact.py <artifact>")
        verify_artifact(sys.argv[1], QUALIFIED_SHA256)
    except (OSError, ValueError) as error:
        sys.exit(str(error))
