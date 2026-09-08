"""Explicit, verified download of the pinned BioCLIP 2 encoder.

This script is the ONLY place where the pilot touches the network for model
weights. It is never invoked by `next build`, by the web application or by an
inference request: the worker refuses to start when the files are missing
instead of downloading them on demand.

    python services/bioclip/download_model.py --dest ~/.lichendr/bioclip-2

Every file is downloaded from the pinned revision, written to a temporary file
and only promoted to its final name after the byte size and the SHA-256 digest
match `constants.py`. The upstream licence/attribution files are downloaded and
kept next to the weights.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from constants import (  # noqa: E402
    ENCODER_CONFIG_FILENAME,
    ENCODER_LICENSE_FILES,
    ENCODER_REPO_ID,
    ENCODER_REVISION,
    ENCODER_TOKENIZER_FILES,
    ENCODER_WEIGHTS_BYTES,
    ENCODER_WEIGHTS_FILENAME,
    ENCODER_WEIGHTS_SHA256,
)

HUB_BASE = "https://huggingface.co"
CHUNK = 1024 * 1024


class DownloadError(RuntimeError):
    """Raised when a file cannot be downloaded or fails verification."""


def file_url(filename: str) -> str:
    return f"{HUB_BASE}/{ENCODER_REPO_ID}/resolve/{ENCODER_REVISION}/{filename}"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def download(filename: str, destination: Path, *, optional: bool = False) -> Path | None:
    target = destination / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(dir=target.parent, delete=False)
    temporary = Path(handle.name)
    try:
        with urllib.request.urlopen(file_url(filename), timeout=120) as response:  # noqa: S310
            while True:
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                handle.write(chunk)
        handle.close()
        os.replace(temporary, target)
        return target
    except urllib.error.HTTPError as error:
        handle.close()
        temporary.unlink(missing_ok=True)
        if optional and error.code == 404:
            return None
        raise DownloadError(f"{filename}: HTTP {error.code}") from error
    except OSError as error:
        handle.close()
        temporary.unlink(missing_ok=True)
        if optional:
            return None
        raise DownloadError(f"{filename}: {error}") from error


def verify_weights(path: Path) -> None:
    size = path.stat().st_size
    if size != ENCODER_WEIGHTS_BYTES:
        path.unlink(missing_ok=True)
        raise DownloadError(
            f"{path.name}: expected {ENCODER_WEIGHTS_BYTES} bytes, got {size}",
        )
    digest = sha256_of(path)
    if digest != ENCODER_WEIGHTS_SHA256:
        path.unlink(missing_ok=True)
        raise DownloadError(
            f"{path.name}: expected sha256 {ENCODER_WEIGHTS_SHA256}, got {digest}",
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", required=True, help="Directory that will hold the encoder")
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Do not download; only verify an already downloaded directory",
    )
    arguments = parser.parse_args(argv)
    destination = Path(arguments.dest).expanduser()

    weights = destination / ENCODER_WEIGHTS_FILENAME
    try:
        if arguments.verify_only:
            if not weights.exists():
                raise DownloadError(f"{weights} is missing")
        else:
            destination.mkdir(parents=True, exist_ok=True)
            if not weights.exists():
                download(ENCODER_WEIGHTS_FILENAME, destination)
            for name in (ENCODER_CONFIG_FILENAME, *ENCODER_TOKENIZER_FILES):
                if not (destination / name).exists():
                    download(name, destination)
            for name in ENCODER_LICENSE_FILES:
                if not (destination / name).exists():
                    download(name, destination, optional=True)
        verify_weights(weights)
    except DownloadError as error:
        print(f"BioCLIP encoder download failed: {error}", file=sys.stderr)
        return 1

    print(f"BioCLIP 2 encoder verified in {destination}")
    print(f"  revision: {ENCODER_REVISION}")
    print(f"  {ENCODER_WEIGHTS_FILENAME}: {ENCODER_WEIGHTS_BYTES} bytes, sha256 {ENCODER_WEIGHTS_SHA256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
