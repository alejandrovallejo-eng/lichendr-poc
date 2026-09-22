from __future__ import annotations

import unittest
from pathlib import Path


class ScientificWorkflowMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        root = Path(__file__).resolve().parents[3]
        cls.sql = (root / "supabase" / "migrations" / "202608100001_link_four_view_annotations.sql").read_text()

    def test_links_one_annotation_target_to_each_rectified_view(self) -> None:
        self.assertIn("capture_view_id uuid references public.capture_views", self.sql)
        self.assertIn("idx_annotation_sets_capture_view", self.sql)
        self.assertIn("target_width_px", self.sql)
        self.assertIn("target_height_px", self.sql)
        self.assertIn("validate_capture_annotation_target", self.sql)

    def test_capture_has_no_lichen_metrics_until_annotations_complete(self) -> None:
        refresh = self.sql.split("create or replace function public.refresh_capture_series_metrics", 1)[1]
        self.assertIn("when completed_views = 4 then lichen_area else null", refresh)
        self.assertIn("when completed_views = 4 and sampled_area > 0", refresh)

    def test_workflow_states_require_annotation_before_completion(self) -> None:
        for state in (
            "capture_draft",
            "capture_calibrated",
            "annotation_pending",
            "annotation_in_progress",
            "annotation_completed",
            "analysis_ready",
            "completed",
        ):
            self.assertIn(f"'{state}'", self.sql)
        confirm = self.sql.split("create or replace function public.confirm_capture_series", 1)[1]
        self.assertIn("where id = p_series_id and status = 'analysis_ready'", confirm)

    def test_owner_rls_remains_inherited_through_existing_relations(self) -> None:
        self.assertIn("target public.capture_views", self.sql)
        self.assertNotIn("security definer", self.sql.lower())
        self.assertIn("security invoker", self.sql.lower())

    def test_trunk_measurement_keeps_tape_and_ai_distinct(self) -> None:
        self.assertIn("'field_tape'", self.sql)
        self.assertIn("'frame_assisted_ai_estimate'", self.sql)
        self.assertIn("trunk_estimate_min_cm", self.sql)
        self.assertIn("trunk_estimate_max_cm", self.sql)
