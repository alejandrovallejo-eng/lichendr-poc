"""Immutable identifiers of the BioCLIP 2 pilot.

Nothing in this module downloads anything. The values are pinned so that the
encoder, the label set and the prompt set can be verified byte by byte before
any inference runs, and so that every suggestion can be traced back to the
exact artefacts that produced it.
"""

from __future__ import annotations

# --- Encoder -----------------------------------------------------------------
# Frozen BioCLIP 2 image/text encoder. The revision is pinned: `main` is never
# used, so an upstream change can never silently alter the pilot.
ENCODER_REPO_ID = "imageomics/bioclip-2"
ENCODER_REVISION = "2957b322090f9cb17ae72c71981c7218a28d81e0"
ENCODER_WEIGHTS_FILENAME = "open_clip_model.safetensors"
ENCODER_WEIGHTS_SHA256 = "b7b2bf6fbc95799e42630e394cf95803892ab447c1a8ab629dbc82fbeaf7dfef"
ENCODER_WEIGHTS_BYTES = 1710517724

# Official metadata files distributed with the checkpoint. They are plain JSON
# and text: no Python is ever fetched or executed from the hub (there is no
# `trust_remote_code` path in this worker).
ENCODER_CONFIG_FILENAME = "open_clip_config.json"
ENCODER_TOKENIZER_FILES = (
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
)
ENCODER_LICENSE_FILES = ("LICENSE", "LICENSE.md", "README.md")

# `open_clip` architecture used by the checkpoint. Verified against
# `open_clip_config.json` at load time; a mismatch aborts the load.
ENCODER_ARCHITECTURE = "ViT-L-14"
ENCODER_EMBED_DIM = 768

# Identifier stored with every suggestion for traceability.
ENCODER_ID = f"{ENCODER_REPO_ID}@{ENCODER_REVISION[:12]}"

# --- Labels and prompts ------------------------------------------------------
# Exact English labels, in the exact order used by the reviewer's trained head.
# They must never be translated before reaching the text encoder: the Spanish
# strings live in the web UI only.
LABELS: tuple[str, str, str] = ("lichen", "moss", "bare tree bark")

# Two prompt templates, applied to every label.
PROMPT_TEMPLATES: tuple[str, str] = (
    "a photo of {label}.",
    "a close-up photo of {label}.",
)

# Spanish presentation names, kept next to the canonical labels so the UI never
# invents its own mapping.
LABEL_DISPLAY_ES = {
    "lichen": "liquen",
    "moss": "musgo",
    "bare tree bark": "corteza desnuda",
}

# Internal class identifiers used by the reviewer's trained head, in the exact
# order of its columns. `bark` is that internal identifier; `bare tree bark` is
# the text fed to the encoder in the zero-shot prompts. They describe the same
# class and are mapped explicitly so neither side has to guess.
HEAD_LABELS: tuple[str, str, str] = ("lichen", "moss", "bark")
HEAD_LABEL_TO_PROMPT_LABEL = {
    "lichen": "lichen",
    "moss": "moss",
    "bark": "bare tree bark",
}

# --- Versions ----------------------------------------------------------------
# Bumped whenever preprocessing, the prompt set or the aggregation changes, so
# cached suggestions are invalidated instead of silently reused.
PREPROCESS_VERSION = "crop-context-1"
ZEROSHOT_VERSION = "zeroshot-1"
SUGGESTION_SCHEMA_VERSION = "1"

# --- Operational limits ------------------------------------------------------
MAX_REQUEST_BYTES = 8 * 1024 * 1024
MAX_CROP_BYTES = 2 * 1024 * 1024
MAX_CROP_PIXELS = 4096 * 4096
MAX_REGIONS_PER_REQUEST = 24

# Aggregate caps. They are the ones the web route must respect: 24 regions of
# 1 MiB each would be 24 MiB, far above `MAX_REQUEST_BYTES`, so the route caps
# the total payload at the same 8 MiB and the same aggregate pixel budget.
MAX_TOTAL_CROP_BYTES = MAX_REQUEST_BYTES
MAX_TOTAL_CROP_PIXELS = 24 * 1024 * 1024

# The encoder runs in microbatches so peak memory does not grow with the number
# of regions in a single request.
ENCODER_MICROBATCH_SIZE = 4

MAX_QUEUE_DEPTH = 4
REQUEST_TIMEOUT_SECONDS = 120.0
