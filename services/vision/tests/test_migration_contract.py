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
        self.assertIn("revoke all on table public.capture_series from public, anon", self.sql)
        self.assertIn("revoke all on table public.capture_views from public, anon", self.sql)
        self.assertNotIn("grant select, insert, update, delete on public.capture_", self.sql)

    def test_view_image_and_annotation_belong_to_the_capture_sample(self) -> None:
        self.assertGreaterEqual(self.sql.count("i.tree_sample_id = cs.tree_sample_id"), 2)
        self.assertGreaterEqual(
            self.sql.count("aset.image_id = public.capture_views.image_id"),
            2,
        )

    def test_physical_area_limits_are_database_constraints(self) -> None:
        self.assertIn("total_valid_area_cm2 <= 2000", self.sql)
        self.assertIn("total_lichen_area_cm2 <= total_valid_area_cm2", self.sql)
        self.assertIn("valid_area_cm2 <= 500", self.sql)
        self.assertIn("lichen_union_area_cm2 <= valid_area_cm2", self.sql)

    def test_confirmation_is_atomic_and_requires_four_views(self) -> None:
        self.assertIn("create or replace function public.confirm_capture_series", self.sql)
        self.assertIn("if active_valid <> 4", self.sql)
        self.assertIn("set status = 'completed'", self.sql)

    def test_retry_returns_existing_request_before_replacing_a_view(self) -> None:
        function = self.sql.split("create or replace function public.register_capture_view", 1)[1]
        existing = function.index("where request_key = p_request_key")
        replacement = function.index("update public.capture_views set active = false")
        insertion = function.index("insert into public.capture_views")
        self.assertLess(existing, replacement)
        self.assertLess(replacement, insertion)


if __name__ == "__main__":
    unittest.main()
