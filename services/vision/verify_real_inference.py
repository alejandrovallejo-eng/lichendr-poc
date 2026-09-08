"""Opt-in real-model regression, never replaced by a fake predictor.

Run each backend in a separate process, using the same image and checkpoint.
The optional NPZ files let the test compare embeddings and actual mask pixels.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

import app  # Include the complete web service's imports in the measured process.
import model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--prepare-fixture", type=Path, help="Create the browser-sized JPEG in a separate process")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--max-peak-mb", type=float)
    args = parser.parse_args()
    if args.prepare_fixture:
        # This represents work done by the browser, NOT memory used by Render.
        with Image.open(args.image) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            image.save(args.prepare_fixture, format="JPEG", quality=92)
        return
    started = time.monotonic()
    model.load_model(app.CHECKPOINT_PATH)
    encoded = args.image.read_bytes()
    timings = []
    for _ in range(args.repeat):
        sid, width, height, prepare_ms = model.prepare_session(encoded, "image/jpeg")
        features = model._sessions[sid].predictor_state["features"]
        if hasattr(features, "numpy"):
            features = features.numpy()
        candidates, best, segment_ms = model.segment_session(sid, [{"x": .52, "y": .5, "label": 1}])
        masks = np.stack([
            np.asarray(Image.open(io.BytesIO(base64.b64decode(c["maskDataUrl"].split(",")[1])))) > 0
            for c in candidates
        ])
        assert masks.shape == (3, height, width)
        assert masks.any(), "Real model returned only empty masks"
        timings.append({"prepare_ms": round(prepare_ms), "segment_ms": round(segment_ms)})
        if args.output:
            np.savez_compressed(args.output, features=features, masks=masks,
                                scores=np.array([c["score"] for c in candidates]))
        model.delete_session(sid)
        del features, candidates, masks
        model.release_unused_memory()
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mb = peak / (1024 * 1024 if sys.platform == "darwin" else 1024)
    report = {"model": model.MODEL_NAME, "peak_process_mb": round(peak_mb, 1),
              "torch_imported": "torch" in sys.modules, "runs": timings,
              "elapsed_seconds": round(time.monotonic() - started, 1)}
    print(json.dumps(report))
    if args.max_peak_mb is not None and peak_mb >= args.max_peak_mb:
        raise SystemExit(f"Real model exceeded memory budget: {peak_mb:.1f} MB")


if __name__ == "__main__":
    main()
