from __future__ import annotations

import asyncio
import contextlib
import io
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import app as vision_app
import model


class _FakeTorch:
    contexts = 0

    @classmethod
    @contextlib.contextmanager
    def inference_mode(cls):
        cls.contexts += 1
        yield


class _FakePredictor:
    def __init__(self) -> None:
        self.embedding = object()
        self.features = None
        self.original_size = None
        self.input_size = None
        self.is_image_set = False
        self.point_coords: np.ndarray | None = None

    def set_image(self, image: np.ndarray) -> None:
        self.features = self.embedding
        self.original_size = image.shape[:2]
        self.input_size = image.shape[:2]
        self.is_image_set = True

    def predict(self, *, point_coords: np.ndarray, point_labels: np.ndarray, multimask_output: bool):
        self.point_coords = point_coords.copy()
        height, width = self.original_size
        masks = np.zeros((3, height, width), dtype=bool)
        masks[:, : max(1, height // 2), : max(1, width // 2)] = True
        return masks, np.float32([0.2, 0.9, 0.4]), np.zeros((3, 4, 4), dtype=np.float32)

    def reset_image(self) -> None:
        self.features = None
        self.original_size = None
        self.input_size = None
        self.is_image_set = False


def _large_encoded_image(image_format: str) -> bytes:
    image = Image.new("RGB", (2400, 1200), (91, 127, 63))
    output = io.BytesIO()
    if image_format == "JPEG":
        image.save(output, format="JPEG", quality=95)
    else:
        try:
            from pillow_heif import from_pillow
        except ImportError as exc:
            raise unittest.SkipTest("pillow-heif is not installed") from exc
        from_pillow(image).save(output, quality=95)
    payload = output.getvalue()
    return payload + bytes(5 * 1024 * 1024 - len(payload))


class MemoryBudgetTests(unittest.TestCase):
    def tearDown(self) -> None:
        model._sessions.clear()

    def test_large_jpeg_and_heic_are_reduced_before_model_embedding(self) -> None:
        for mime, image_format in (("image/jpeg", "JPEG"), ("image/heic", "HEIF")):
            with self.subTest(mime=mime):
                payload = _large_encoded_image(image_format)
                self.assertGreater(len(payload), 4.5 * 1024 * 1024)
                decoded = model._open_image_bytes(payload, mime)
                self.assertEqual(decoded.size, (2048, 1024))

    def test_session_reuses_one_embedding_without_tensor_clones_and_scales_points(self) -> None:
        predictor = _FakePredictor()
        payload = _large_encoded_image("JPEG")
        _FakeTorch.contexts = 0
        with (
            patch.object(model, "_model_loaded", True),
            patch.object(model, "_predictor", predictor),
            patch.object(model, "torch", _FakeTorch),
            patch.object(model, "log_rss"),
            patch.object(model, "release_unused_memory"),
        ):
            session_id, width, height, _ = model.prepare_session(payload, "image/jpeg")
            state = model._sessions[session_id].predictor_state
            self.assertIs(state["features"], predictor.embedding)
            self.assertIsNone(predictor.features)

            candidates, recommended, _ = model.segment_session(
                session_id,
                [{"x": 0.5, "y": 0.25, "label": 1}],
            )

        np.testing.assert_allclose(predictor.point_coords, [[1024 * 0.5, 512 * 0.25]])
        self.assertEqual((width, height), (2048, 1024))
        self.assertEqual((candidates[0]["width"], candidates[0]["height"]), (2048, 1024))
        self.assertEqual(recommended, 1)
        self.assertIsNone(predictor.features)
        self.assertEqual(_FakeTorch.contexts, 2)

    def test_canonical_scientific_mask_returns_at_target_resolution(self) -> None:
        output = io.BytesIO()
        Image.new("RGB", (400, 2000), (91, 127, 63)).save(output, format="JPEG", quality=95)
        predictor = _FakePredictor()
        with (
            patch.object(model, "_model_loaded", True),
            patch.object(model, "_predictor", predictor),
            patch.object(model, "torch", _FakeTorch),
            patch.object(model, "log_rss"),
            patch.object(model, "release_unused_memory"),
        ):
            session_id, width, height, _ = model.prepare_session(output.getvalue(), "image/jpeg")
            candidates, _, _ = model.segment_session(
                session_id,
                [{"x": 0.5, "y": 0.5, "label": 1}],
            )

        self.assertEqual((width, height), (400, 2000))
        np.testing.assert_allclose(predictor.point_coords, [[102.5, 512]])
        self.assertEqual((candidates[0]["width"], candidates[0]["height"]), (400, 2000))

    def test_session_cache_evicts_only_the_oldest_embedding_at_capacity(self) -> None:
        for index in range(model.MAX_SESSIONS):
            session_id = f"session-{index}"
            model._sessions[session_id] = model._Session(
                session_id,
                {"features": object()},
                10,
                10,
                10,
                10,
            )
        model._evict_lru_if_full()
        self.assertEqual(list(model._sessions), ["session-1", "session-2"])

    def test_rss_probe_reports_a_positive_process_value(self) -> None:
        self.assertGreater(model.current_rss_mb(), 0)


class InferenceSerializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_one_inference_request_enters_at_a_time(self) -> None:
        first = vision_app._single_inference_request()
        second = vision_app._single_inference_request()
        with (
            patch.object(vision_app, "log_rss"),
            patch.object(vision_app, "release_unused_memory"),
        ):
            await anext(first)
            waiting = asyncio.create_task(anext(second))
            await asyncio.sleep(0)
            self.assertFalse(waiting.done())
            await first.aclose()
            await asyncio.wait_for(waiting, timeout=1)
            await second.aclose()


if __name__ == "__main__":
    unittest.main()
