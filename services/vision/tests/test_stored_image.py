from __future__ import annotations

import unittest
from unittest.mock import patch

import app as vision_app


class _Response:
    def __init__(self, url: str, mime: str, content: bytes) -> None:
        self._url = url
        self._content = content
        self._offset = 0
        self.headers = {
            "Content-Type": mime,
            "Content-Length": str(len(content)),
        }

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def geturl(self) -> str:
        return self._url

    def read(self, size: int) -> bytes:
        chunk = self._content[self._offset:self._offset + size]
        self._offset += len(chunk)
        return chunk


class _Opener:
    def __init__(self, response: _Response) -> None:
        self.response = response

    def open(self, request: object, timeout: int) -> _Response:
        self.timeout = timeout
        return self.response


class StoredImageTests(unittest.TestCase):
    def test_downloads_large_jpeg_and_heic_without_function_payload(self) -> None:
        size = 5 * 1024 * 1024
        url = (
            "https://project.supabase.co/storage/v1/object/sign/"
            "lichen-images/user/project/image?token=short-lived"
        )
        fixtures = {
            "image/jpeg": b"\xff\xd8\xff" + bytes(size - 3),
            "image/heic": b"\x00\x00\x00\x18ftypheic" + bytes(size - 12),
        }
        for mime, content in fixtures.items():
            with self.subTest(mime=mime):
                response = _Response(url, mime, content)
                with (
                    patch.object(vision_app, "_SUPABASE_STORAGE_HOST", "project.supabase.co"),
                    patch.object(vision_app, "build_opener", return_value=_Opener(response)),
                ):
                    downloaded = vision_app._download_signed_image(url, mime, size)
                self.assertEqual(downloaded[:3], content[:3])
                self.assertEqual(len(downloaded), size)

    def test_rejects_http_wrong_hosts_and_unsigned_paths(self) -> None:
        unsafe = [
            "http://project.supabase.co/storage/v1/object/sign/lichen-images/a?token=x",
            "https://other.supabase.co/storage/v1/object/sign/lichen-images/a?token=x",
            "https://project.supabase.co/storage/v1/object/public/lichen-images/a?token=x",
            "https://project.supabase.co/storage/v1/object/sign/lichen-images/a",
        ]
        with patch.object(vision_app, "_SUPABASE_STORAGE_HOST", "project.supabase.co"):
            for url in unsafe:
                with self.subTest(url=url), self.assertRaises(ValueError):
                    vision_app._validate_signed_image_url(url)


if __name__ == "__main__":
    unittest.main()
