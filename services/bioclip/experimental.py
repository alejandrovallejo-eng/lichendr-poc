"""Frozen opt-in comparison. Never replaces the deployed three-class head."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from head import HeadValidationError, sha256_of_file

LABELS = ("lichen", "moss", "bark", "algae", "other_fungus")
MODEL_ID = "inat-five-class-20260917"
ENCODER_SHA = "b7b2bf6fbc95799e42630e394cf95803892ab447c1a8ab629dbc82fbeaf7dfef"
FILES = {
    "classifier-five-class.npz": "be525fbe8810348cd0263f8b2766d4e186559a9d68bae001d16eae5d1624929f",
    "reference-embeddings.npz": "9de9db61416170a66a59e671e47b115129eca4571c92514f34a873012f26f37d",
    "rejection-policy.json": "782403370b138c870b26300a92bbdda28145a7c90d7229a144f5761b5323af83",
}
# Identity includes rejection policy and references, not just the linear head.
BUNDLE_SHA = hashlib.sha256(json.dumps(FILES, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def encode_experimental(encoder, crops):
    """Exact frozen-study transform; legacy preprocessing is intentionally untouched.

    Reuse the loaded network, but not embeddings from its hand-rounded legacy
    transform. Resize/CenterCrop rounding and tensor normalization must match
    the study. Serial single-image inference bounds memory.
    """
    import torch
    from torchvision.transforms import Compose, Resize, CenterCrop, ToTensor, Normalize, InterpolationMode
    transform = Compose([Resize(224, interpolation=InterpolationMode.BICUBIC), CenterCrop(224),
                         ToTensor(), Normalize((.48145466, .4578275, .40821073), (.26862954, .26130258, .27577711))])
    result = []
    for crop in crops:
        tensor = transform(crop.convert("RGB")).unsqueeze(0)
        with torch.inference_mode():
            features = encoder.model.encode_image(tensor)
            features = features / features.norm(dim=-1, keepdim=True)
        result.append(features[0].cpu().numpy().copy())
    return np.stack(result)


@dataclass(frozen=True)
class ExperimentalHead:
    weights: np.ndarray
    mean: np.ndarray
    intercept: np.ndarray
    references: np.ndarray
    reference_labels: np.ndarray
    margin_min: float
    similarity_min: float

    def compare(self, embeddings: np.ndarray, region_ids: list[str]) -> dict:
        x = np.asarray(embeddings, dtype=np.float64)
        if x.ndim != 2 or x.shape != (len(region_ids), 768) or not np.isfinite(x).all():
            raise HeadValidationError("Invalid experimental embeddings")
        values = (x - self.mean) @ self.weights + self.intercept
        result = []
        for i, region_id in enumerate(region_ids):
            order = np.argsort(values[i])[::-1]
            top = int(order[0])
            margin = float(values[i, top] - values[i, order[1]])
            support = float(np.max(x[i] @ self.references[self.reference_labels == top].T))
            rejected = margin < self.margin_min or support < self.similarity_min
            result.append({"regionId": region_id, "decision": "undetermined" if rejected else LABELS[top],
                           "status": "pending", "ranking": [{"label": LABELS[int(j)], "rawScore": float(values[i, j])} for j in order]})
        return {"modelId": MODEL_ID, "bundleSha256": BUNDLE_SHA, "experimental": True,
                "preprocess": "standard_center_crop", "suggestions": result}


def load_experimental(directory: str) -> ExperimentalHead:
    root = Path(directory)
    try:
        for name, digest in FILES.items():
            path = root / name
            if not path.is_file() or not 0 < path.stat().st_size < 4 * 1024 * 1024 or sha256_of_file(path) != digest:
                raise HeadValidationError("Experimental artefact integrity check failed")
        with np.load(root / "classifier-five-class.npz", allow_pickle=False) as z:
            if set(z.files) != {"weights", "feature_mean", "intercept", "labels"} or tuple(z["labels"]) != LABELS:
                raise HeadValidationError("Invalid experimental head contract")
            w, m, b = [np.array(z[k], dtype=np.float64) for k in ("weights", "feature_mean", "intercept")]
        with np.load(root / "reference-embeddings.npz", allow_pickle=False) as z:
            r, y = np.array(z["features"], dtype=np.float64), np.array(z["labels"])
        if w.shape != (768, 5) or m.shape != (768,) or b.shape != (5,) or r.shape != (158, 768) or y.shape != (158,):
            raise HeadValidationError("Invalid experimental dimensions")
        if set(y.tolist()) != set(range(5)) or not all(np.isfinite(a).all() for a in (w, m, b, r)):
            raise HeadValidationError("Invalid experimental values")
        policy = json.loads((root / "rejection-policy.json").read_text())
        for a in (w, m, b, r, y):
            a.setflags(write=False)
        return ExperimentalHead(w, m, b, r, y, float(policy["margin_min"]), float(policy["similarity_min"]))
    except HeadValidationError:
        raise
    except Exception as error:
        raise HeadValidationError("Experimental bundle could not be loaded") from error
