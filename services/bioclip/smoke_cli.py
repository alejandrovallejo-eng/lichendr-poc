"""Real MobileSAM -> BioCLIP smoke run over local image files.

This is the end-to-end check the reviewer runs on the Mac, with their own
private photographs (they are never published, and the agent that wrote this
code has no access to them):

    python services/bioclip/smoke_cli.py \
        --image ~/fotos/arbol-07-N.jpg \
        --mobile-sam-checkpoint ~/models/mobile_sam.pt \
        --model-dir ~/.lichendr/bioclip-2 \
        --out /tmp/lichendr-smoke

For each image it prints, and writes to `<out>/<image>.json`:

* the MobileSAM regions (bounding box, mask area, SAM score — the SAM score is
  a mask-quality number, it does not identify lichen);
* the crop actually sent to BioCLIP and its transformation chain;
* the ranked raw scores per label and the backend used (zero-shot or head);
* wall-clock time per stage and peak RSS.

It also writes `<out>/<image>-overlay.png`, the photograph with the proposed
masks drawn on top, so the proposals can be eyeballed before any review.

Nothing here is a validation of biological accuracy: it only proves that the
software path runs on real models with real images.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))

from crops import (  # noqa: E402
    Box,
    DUPLICATE_IOU,
    expand_with_context,
    intersection_over_union,
    mask_bounding_box,
    scale_to_max_side,
)
from encoder import load_encoder  # noqa: E402
from head import load_trained_head  # noqa: E402
from suggest import suggest  # noqa: E402

MOBILE_SAM_SHA256 = "6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f"
MAX_SIDE = 1024
GRID_ROWS = 5
GRID_COLUMNS = 2
OVERLAY_COLOR = np.array([255, 64, 160], dtype=np.float32)


def peak_rss_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports kilobytes, macOS reports bytes.
    return usage / 1024 if sys.platform != "darwin" else usage / (1024 * 1024)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_mobile_sam(checkpoint: Path, *, skip_checksum: bool):
    import torch  # noqa: PLC0415
    from mobile_sam import SamPredictor, sam_model_registry  # noqa: PLC0415

    if not skip_checksum and sha256_of(checkpoint) != MOBILE_SAM_SHA256:
        raise SystemExit(
            "El checkpoint de MobileSAM no coincide con el SHA-256 fijado "
            "(usa --skip-sam-checksum solo si sabes por qué difiere).",
        )
    model = sam_model_registry["vit_t"](checkpoint=str(checkpoint))
    model.eval()
    torch.set_grad_enabled(False)
    return SamPredictor(model)


def propose_regions(predictor, image: np.ndarray) -> list[dict]:
    """Fixed, reproducible prompt grid — the same one used by services/vision."""

    height, width = image.shape[:2]
    predictor.set_image(image)
    proposals: list[dict] = []
    for row in range(GRID_ROWS):
        for column in range(GRID_COLUMNS):
            point = np.array(
                [[(column + 0.5) / GRID_COLUMNS * width, (row + 0.5) / GRID_ROWS * height]],
                dtype=np.float32,
            )
            masks, scores, _ = predictor.predict(
                point_coords=point,
                point_labels=np.array([1], dtype=np.int32),
                multimask_output=True,
            )
            selected = int(np.argmax(scores))
            proposals.append(
                {
                    "mask": masks[selected].astype(np.uint8),
                    "samScore": float(scores[selected]),
                    "point": [float(point[0][0]), float(point[0][1])],
                }
            )
    return proposals


def build_crops(image: Image.Image, proposals: list[dict]) -> list[dict]:
    width, height = image.size
    boxes: list[Box] = []
    kept: list[dict] = []
    for index, proposal in enumerate(proposals):
        tight = mask_bounding_box(proposal["mask"].tolist())
        if tight is None or tight.area <= 0:
            continue
        expanded = expand_with_context(tight, width, height)
        if any(intersection_over_union(expanded, other) >= DUPLICATE_IOU for other in boxes):
            continue
        boxes.append(expanded)
        scale = scale_to_max_side(expanded)
        crop = image.crop(
            (expanded.x, expanded.y, expanded.x + expanded.width, expanded.y + expanded.height)
        )
        if scale < 1.0:
            crop = crop.resize(
                (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
                Image.BICUBIC,
            )
        kept.append(
            {
                "regionId": f"region-{index:02d}",
                "crop": crop,
                "mask": proposal["mask"],
                "samScore": proposal["samScore"],
                "transformChain": [
                    {"step": "exif_orientation", "applied": True},
                    {"step": "mask_bounding_box", "box": tight.as_dict()},
                    {"step": "context_expansion", "box": expanded.as_dict()},
                    {"step": "crop_downscale", "scale": scale},
                    {"step": "encoder_preprocess", "centerCrop": False},
                ],
            }
        )
    return kept


def write_overlay(image: Image.Image, regions: list[dict], destination: Path) -> None:
    canvas = np.asarray(image.convert("RGB"), dtype=np.float32)
    for region in regions:
        mask = region["mask"].astype(bool)
        if mask.shape != canvas.shape[:2]:
            continue
        canvas[mask] = 0.55 * canvas[mask] + 0.45 * OVERLAY_COLOR
    Image.fromarray(canvas.clip(0, 255).astype(np.uint8)).save(destination)


def run_image(path: Path, predictor, encoder, trained_head, preprocess: str, out: Path) -> dict:
    started = time.monotonic()
    image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    original_size = image.size
    scale = min(1.0, MAX_SIDE / max(image.size))
    if scale < 1.0:
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)), Image.BICUBIC
        )
    decoded_ms = (time.monotonic() - started) * 1000

    sam_started = time.monotonic()
    proposals = propose_regions(predictor, np.asarray(image))
    sam_ms = (time.monotonic() - sam_started) * 1000

    regions = build_crops(image, proposals)
    write_overlay(image, regions, out / f"{path.stem}-overlay.png")

    bioclip_started = time.monotonic()
    batch = suggest(
        encoder,
        [region["crop"] for region in regions],
        [region["regionId"] for region in regions],
        preprocess_mode=preprocess,
        trained_head=trained_head,
    )
    bioclip_ms = (time.monotonic() - bioclip_started) * 1000

    report = {
        "image": path.name,
        "imageSha256": sha256_of(path),
        "originalSize": {"width": original_size[0], "height": original_size[1]},
        "workingSize": {"width": image.width, "height": image.height},
        "backend": batch.backend,
        "encoderId": batch.encoder_id,
        "encoderSha256": batch.encoder_sha256,
        "headSha256": batch.head_sha256,
        "preprocess": batch.preprocess_mode,
        "versions": batch.versions,
        "timingsMs": {
            "decode": round(decoded_ms, 1),
            "mobileSam": round(sam_ms, 1),
            "bioclip": round(bioclip_ms, 1),
        },
        "peakRssMb": round(peak_rss_mb(), 1),
        "regions": [
            {
                "regionId": region["regionId"],
                "samScore": region["samScore"],
                "maskAreaPixels": int(region["mask"].sum()),
                "transformChain": region["transformChain"],
                "status": suggestion.status,
                "ranking": suggestion.ranking,
            }
            for region, suggestion in zip(regions, batch.suggestions)
        ],
        "limitations": [
            "El score de MobileSAM mide calidad de máscara, no presencia de liquen.",
            "Una región puede mezclar sustratos: la etiqueta no segmenta sus píxeles.",
            "Puntuaciones crudas, no probabilidades; todo queda pendiente de revisión.",
        ],
    }
    (out / f"{path.stem}.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", action="append", required=True, help="Local image path")
    parser.add_argument("--mobile-sam-checkpoint", required=True)
    parser.add_argument("--model-dir", required=True, help="Verified BioCLIP 2 directory")
    parser.add_argument("--head", default=None, help="Optional trained head (.npz)")
    parser.add_argument("--head-sha256", default=None)
    parser.add_argument("--preprocess", default="whole_crop_pad")
    parser.add_argument("--out", required=True)
    parser.add_argument("--skip-sam-checksum", action="store_true")
    arguments = parser.parse_args(argv)

    out = Path(arguments.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)

    predictor = load_mobile_sam(
        Path(arguments.mobile_sam_checkpoint).expanduser(),
        skip_checksum=arguments.skip_sam_checksum,
    )
    encoder = load_encoder(arguments.model_dir)
    trained_head = (
        load_trained_head(arguments.head, expected_sha256=arguments.head_sha256)
        if arguments.head
        else None
    )
    if arguments.head:
        print(f"Cabeza entrenada cargada: sha256={trained_head.sha256}")
    else:
        print("Sin cabeza entrenada: backend zero-shot.")

    for raw_path in arguments.image:
        report = run_image(
            Path(raw_path).expanduser(), predictor, encoder, trained_head, arguments.preprocess, out
        )
        print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"Artefactos escritos en {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
