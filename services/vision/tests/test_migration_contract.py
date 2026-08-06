from __future__ import annotations

import unittest
from pathlib import Path


class MigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        root = Path(__file__).resolve().parents[3]
        cls.sql = (root / "supabase" / "migrations" / "202608060002_create_four_view_capture_series.sql").read_text()

    def test_enforces_one_active_direction_and_idempotency_keys(self) -> None:
        self.assertIn("idx_capture_views_active_direction", self.sql)
        self.assertIn("where active", self.sql)
        self.assertGreaterEqual(self.sql.count("request_key uuid not null"), 2)
        self.assertIn("where request_key = p_request_key", self.sql)

    def test_owner_rls_covers_series_and_views(self) -> None:
        self.assertIn("alter table public.capture_series enable row level security", self.sql)
        self.assertIn("alter table public.capture_views enable row level security", self.sql)
        self.assertGreaterEqual(self.sql.count("p.owner_id = auth.uid()"), 8)

    def test_confirmation_is_atomic_and_requires_four_views(self) -> None:
        self.assertIn("create or replace function public.confirm_capture_series", self.sql)
        self.assertIn("if active_valid <> 4", self.sql)
        self.assertIn("set status = 'completed'", self.sql)


if __name__ == "__main__":
    unittest.main()
