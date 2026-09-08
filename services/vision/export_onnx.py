"""Build immutable FP32 MobileSAM graphs; PyTorch is a build-only dependency.

No quantization, model resizing or changes to learned weights are performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from mobile_sam import sam_model_registry
from mobile_sam.utils.onnx import SamOnnxModel


CHECKPOINT_SHA256 = "6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f"


class BandedMBConv(torch.nn.Module):
    """Evaluate the same local convolution in bands with exact one-row halos.

    The first TinyViT layer otherwise expands a 256x256 map to 256 channels,
    creating several 64 MiB GELU/convolution intermediates simultaneously.
    This is not image tiling: no attention, positions or output geometry change.
    BatchNorm must be in eval mode, and the sole spatial kernel is 3x3/stride 1.
    """
    def __init__(self, block: torch.nn.Module):
        super().__init__()
        self.block = block
        assert block.conv2.c.kernel_size == (3, 3)
        assert block.conv2.c.stride == (1, 1)

    def forward(self, x):
        pieces = []
        height = 256  # Fixed, validated 1024px encoder input -> 256px first layer.
        for start in range(0, height, 32):
            end = min(start + 32, height)
            lo, hi = max(0, start - 1), min(height, end + 1)
            band = self.block(x[:, :, lo:hi, :])
            pieces.append(band[:, :, start - lo:end - lo, :])
        return torch.cat(pieces, dim=2)


class BandedPatchEmbed(torch.nn.Module):
    """Same two stride-2 convolutions, with stride-aligned four-pixel halos."""
    def __init__(self, block):
        super().__init__()
        self.block = block

    def forward(self, x):
        pieces = []
        for start in range(0, 1024, 128):
            end = start + 128
            lo, hi = max(0, start - 4), min(1024, end + 4)
            band = self.block(x[:, :, lo:hi, :])
            pieces.append(band[:, :, (start-lo)//4:(end-lo)//4, :])
        return torch.cat(pieces, dim=2)


class BandedMlp(torch.nn.Module):
    """Token-wise LayerNorm/MLP has no dependencies between token bands."""
    def __init__(self, block):
        super().__init__()
        self.block = block

    def forward(self, x):
        return torch.cat([self.block(x[:, start:start+1024, :])
                          for start in range(0, 16384, 1024)], dim=1)


def export(checkpoint: Path, destination: Path) -> None:
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != CHECKPOINT_SHA256:
        raise ValueError("MobileSAM checkpoint checksum mismatch")
    torch.set_num_threads(1)
    model = sam_model_registry["vit_t"](checkpoint=str(checkpoint)).eval()
    # Verify banding against the unmodified block with nonzero inputs before export.
    torch.manual_seed(0)
    for index, block in enumerate(model.image_encoder.layers[0].blocks):
        banded = BandedMBConv(block).eval()
        with torch.inference_mode():
            sample = torch.randn(1, block.in_chans, 256, 256)
            torch.testing.assert_close(banded(sample), block(sample), atol=2e-5, rtol=2e-5)
        model.image_encoder.layers[0].blocks[index] = banded
    original_patch = model.image_encoder.patch_embed
    model.image_encoder.patch_embed = BandedPatchEmbed(original_patch).eval()
    with torch.inference_mode():
        sample = torch.randn(1, 3, 1024, 1024)
        torch.testing.assert_close(model.image_encoder.patch_embed(sample), original_patch(sample), atol=2e-5, rtol=2e-5)
    for block in model.image_encoder.layers[1].blocks:
        original_mlp = block.mlp
        block.mlp = BandedMlp(original_mlp).eval()
        with torch.inference_mode():
            sample = torch.randn(1, 16384, block.dim)
            torch.testing.assert_close(block.mlp(sample), original_mlp(sample), atol=2e-5, rtol=2e-5)
    destination.mkdir(parents=True, exist_ok=True)
    encoder_path = destination / "encoder.onnx"
    decoder_path = destination / "decoder.onnx"
    image = torch.zeros(1, 3, 1024, 1024)
    with torch.inference_mode():
        torch.onnx.export(
            model.image_encoder, image, str(encoder_path), opset_version=17,
            input_names=["image"], output_names=["embeddings"],
        )
        embeddings = model.image_encoder(image)
        decoder = SamOnnxModel(model, return_single_mask=False).eval()
        inputs = (
            embeddings,
            torch.tensor([[[512., 512.], [0., 0.]]]),
            torch.tensor([[1., -1.]]),
            torch.zeros(1, 1, 256, 256), torch.zeros(1),
            torch.tensor([768., 1024.]),
        )
        names = ["image_embeddings", "point_coords", "point_labels", "mask_input", "has_mask_input", "orig_im_size"]
        torch.onnx.export(
            decoder, inputs, str(decoder_path), opset_version=17,
            input_names=names, output_names=["masks", "scores", "low_res_masks"],
            dynamic_axes={"point_coords": {1: "num_points"}, "point_labels": {1: "num_points"},
                          "masks": {2: "height", 3: "width"}},
        )
        # Fail the build if either graph is invalid or export changed numerical output.
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        for path in (encoder_path, decoder_path):
            onnx.checker.check_model(str(path))
        encoder = ort.InferenceSession(str(encoder_path), options, providers=["CPUExecutionProvider"])
        actual = encoder.run(None, {"image": image.numpy()})[0]
        np.testing.assert_allclose(actual, embeddings.numpy(), atol=2e-3, rtol=2e-3)
        del encoder
        runtime_decoder = ort.InferenceSession(str(decoder_path), options, providers=["CPUExecutionProvider"])
        for coords, labels, size in (
            ([[[512., 512.], [0., 0.]]], [[1., -1.]], [768., 1024.]),
            ([[[400., 400.], [100., 200.], [0., 0.]]], [[1., 0., -1.]], [1024., 768.]),
        ):
            sample = (embeddings, torch.tensor(coords), torch.tensor(labels), inputs[3], inputs[4], torch.tensor(size))
            expected = decoder(*sample)
            actual_outputs = runtime_decoder.run(None, dict(zip(names, [value.numpy() for value in sample])))
            for actual_output, expected_output in zip(actual_outputs, expected):
                np.testing.assert_allclose(actual_output, expected_output.numpy(), atol=3e-3, rtol=3e-3)
    metadata = {
        "model": "MobileSAM vit_t", "format": 1, "precision": "float32",
        "checkpoint_sha256": CHECKPOINT_SHA256,
        "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (encoder_path, decoder_path)},
    }
    (destination / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print("MobileSAM ONNX export and numerical parity checks passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    export(args.checkpoint, args.destination)
