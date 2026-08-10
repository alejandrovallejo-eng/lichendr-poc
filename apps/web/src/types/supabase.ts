export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          country_code: string;
          status: "draft" | "provisional_ai" | "completed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          name: string;
          description?: string | null;
          country_code?: string;
          status?: "draft" | "provisional_ai" | "completed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          owner_id?: string;
          name?: string;
          description?: string | null;
          country_code?: string;
          status?: "draft" | "provisional_ai" | "completed";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sites: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          country_code: string;
          province: string | null;
          municipality: string | null;
          latitude: number | null;
          longitude: number | null;
          gps_accuracy_m: number | null;
          location_source: string;
          radius_m: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: string;
          name: string;
          description?: string | null;
          country_code?: string;
          province?: string | null;
          municipality?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          gps_accuracy_m?: number | null;
          location_source?: string;
          radius_m?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          project_id?: string;
          name?: string;
          description?: string | null;
          country_code?: string;
          province?: string | null;
          municipality?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          gps_accuracy_m?: number | null;
          location_source?: string;
          radius_m?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sites_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      sampling_events: {
        Row: {
          id: string;
          site_id: string;
          name: string;
          sampled_at: string;
          observer_names: string | null;
          weather_notes: string | null;
          protocol_version: string;
          status: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          site_id: string;
          name: string;
          sampled_at?: string;
          observer_names?: string | null;
          weather_notes?: string | null;
          protocol_version?: string;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          site_id?: string;
          name?: string;
          sampled_at?: string;
          observer_names?: string | null;
          weather_notes?: string | null;
          protocol_version?: string;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sampling_events_site_id_fkey";
            columns: ["site_id"];
            referencedRelation: "sites";
            referencedColumns: ["id"];
          }
        ];
      };
      trees: {
        Row: {
          id: string;
          site_id: string;
          code: string;
          species_name: string | null;
          species_confidence: string;
          latitude: number | null;
          longitude: number | null;
          gps_accuracy_m: number | null;
          location_source: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          site_id: string;
          code: string;
          species_name?: string | null;
          species_confidence?: string;
          latitude?: number | null;
          longitude?: number | null;
          gps_accuracy_m?: number | null;
          location_source?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          site_id?: string;
          code?: string;
          species_name?: string | null;
          species_confidence?: string;
          latitude?: number | null;
          longitude?: number | null;
          gps_accuracy_m?: number | null;
          location_source?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trees_site_id_fkey";
            columns: ["site_id"];
            referencedRelation: "sites";
            referencedColumns: ["id"];
          }
        ];
      };
      tree_samples: {
        Row: {
          id: string;
          site_id: string;
          sampling_event_id: string;
          tree_id: string;
          substrate_type: string;
          trunk_orientation: string;
          sampling_height_m: number | null;
          shade_level: string;
          confidence_level: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          site_id: string;
          sampling_event_id: string;
          tree_id: string;
          substrate_type?: string;
          trunk_orientation?: string;
          sampling_height_m?: number | null;
          shade_level?: string;
          confidence_level?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          site_id?: string;
          sampling_event_id?: string;
          tree_id?: string;
          substrate_type?: string;
          trunk_orientation?: string;
          sampling_height_m?: number | null;
          shade_level?: string;
          confidence_level?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tree_samples_tree_site_fk";
            columns: ["tree_id", "site_id"];
            referencedRelation: "trees";
            referencedColumns: ["id", "site_id"];
          },
          {
            foreignKeyName: "tree_samples_event_site_fk";
            columns: ["sampling_event_id", "site_id"];
            referencedRelation: "sampling_events";
            referencedColumns: ["id", "site_id"];
          }
        ];
      };
      images: {
        Row: {
          id: string;
          tree_sample_id: string;
          storage_bucket: string;
          storage_path: string;
          original_filename: string;
          mime_type: string;
          file_size_bytes: number;
          width_px: number | null;
          height_px: number | null;
          image_order: number;
          caption: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tree_sample_id: string;
          storage_bucket?: string;
          storage_path: string;
          original_filename: string;
          mime_type: string;
          file_size_bytes: number;
          width_px?: number | null;
          height_px?: number | null;
          image_order?: number;
          caption?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tree_sample_id?: string;
          storage_bucket?: string;
          storage_path?: string;
          original_filename?: string;
          mime_type?: string;
          file_size_bytes?: number;
          width_px?: number | null;
          height_px?: number | null;
          image_order?: number;
          caption?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "images_tree_sample_id_fkey";
            columns: ["tree_sample_id"];
            referencedRelation: "tree_samples";
            referencedColumns: ["id"];
          }
        ];
      };
      image_metadata: {
        Row: {
          id: string;
          image_id: string;
          extraction_status: string;
          captured_at: string | null;
          captured_at_local: string | null;
          timezone_offset: string | null;
          latitude: number | null;
          longitude: number | null;
          gps_accuracy_m: number | null;
          location_source: string;
          camera_make: string | null;
          camera_model: string | null;
          lens_model: string | null;
          orientation: number | null;
          focal_length_mm: number | null;
          aperture_f_number: number | null;
          exposure_time_seconds: number | null;
          iso_speed: number | null;
          software: string | null;
          raw_exif: Record<string, unknown>;
          extraction_error: string | null;
          extracted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          image_id: string;
          extraction_status?: string;
          captured_at?: string | null;
          captured_at_local?: string | null;
          timezone_offset?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          gps_accuracy_m?: number | null;
          location_source?: string;
          camera_make?: string | null;
          camera_model?: string | null;
          lens_model?: string | null;
          orientation?: number | null;
          focal_length_mm?: number | null;
          aperture_f_number?: number | null;
          exposure_time_seconds?: number | null;
          iso_speed?: number | null;
          software?: string | null;
          raw_exif?: Record<string, unknown>;
          extraction_error?: string | null;
          extracted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          image_id?: string;
          extraction_status?: string;
          captured_at?: string | null;
          captured_at_local?: string | null;
          timezone_offset?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          gps_accuracy_m?: number | null;
          location_source?: string;
          camera_make?: string | null;
          camera_model?: string | null;
          lens_model?: string | null;
          orientation?: number | null;
          focal_length_mm?: number | null;
          aperture_f_number?: number | null;
          exposure_time_seconds?: number | null;
          iso_speed?: number | null;
          software?: string | null;
          raw_exif?: Record<string, unknown>;
          extraction_error?: string | null;
          extracted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "image_metadata_image_id_fkey";
            columns: ["image_id"];
            referencedRelation: "images";
            referencedColumns: ["id"];
          }
        ];
      };
      capture_series: {
        Row: {
          id: string; tree_sample_id: string; request_key: string; template_version: string; algorithm_version: string;
          status: "capture_draft" | "capture_calibrated" | "annotation_pending" | "annotation_in_progress" | "annotation_completed" | "analysis_ready" | "completed";
          review_status: "pending" | "confirmed" | "correction_requested";
          total_valid_area_cm2: number | null; total_lichen_area_cm2: number | null; tree_lichen_coverage_percent: number | null;
          occupied_cells: number | null; provisional_morphotype_richness: number | null;
          valid_view_count: number; pending_view_count: number; calculated_at: string | null; confirmed_at: string | null;
          field_circumference_cm: number | null; field_diameter_cm: number | null; field_measurement_height_m: number | null;
          trunk_estimated_width_cm: number | null; trunk_estimated_circumference_cm: number | null;
          trunk_estimate_min_cm: number | null; trunk_estimate_max_cm: number | null; trunk_confidence: "low" | "medium" | "high" | null;
          trunk_views_used: string[]; trunk_geometric_assumption: string | null; trunk_measurement_method: "field_tape" | "frame_assisted_ai_estimate" | null;
          trunk_algorithm_version: string | null; trunk_quality_flags: unknown[];
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tree_sample_id: string; request_key?: string; template_version?: string; algorithm_version: string;
          status?: "capture_draft" | "capture_calibrated" | "annotation_pending" | "annotation_in_progress" | "annotation_completed" | "analysis_ready" | "completed";
          review_status?: "pending" | "confirmed" | "correction_requested";
          total_valid_area_cm2?: number | null; total_lichen_area_cm2?: number | null; tree_lichen_coverage_percent?: number | null;
          occupied_cells?: number | null; provisional_morphotype_richness?: number | null;
          valid_view_count?: number; pending_view_count?: number; calculated_at?: string | null; confirmed_at?: string | null;
          field_circumference_cm?: number | null; field_diameter_cm?: number | null; field_measurement_height_m?: number | null;
          trunk_estimated_width_cm?: number | null; trunk_estimated_circumference_cm?: number | null;
          trunk_estimate_min_cm?: number | null; trunk_estimate_max_cm?: number | null; trunk_confidence?: "low" | "medium" | "high" | null;
          trunk_views_used?: string[]; trunk_geometric_assumption?: string | null; trunk_measurement_method?: "field_tape" | "frame_assisted_ai_estimate" | null;
          trunk_algorithm_version?: string | null; trunk_quality_flags?: unknown[];
          created_at?: string; updated_at?: string;
        };
        Update: {
          tree_sample_id?: string; request_key?: string; template_version?: string; algorithm_version?: string;
          status?: "capture_draft" | "capture_calibrated" | "annotation_pending" | "annotation_in_progress" | "annotation_completed" | "analysis_ready" | "completed";
          review_status?: "pending" | "confirmed" | "correction_requested";
          total_valid_area_cm2?: number | null; total_lichen_area_cm2?: number | null; tree_lichen_coverage_percent?: number | null;
          occupied_cells?: number | null; provisional_morphotype_richness?: number | null;
          valid_view_count?: number; pending_view_count?: number; calculated_at?: string | null; confirmed_at?: string | null;
          field_circumference_cm?: number | null; field_diameter_cm?: number | null; field_measurement_height_m?: number | null;
          trunk_estimated_width_cm?: number | null; trunk_estimated_circumference_cm?: number | null;
          trunk_estimate_min_cm?: number | null; trunk_estimate_max_cm?: number | null; trunk_confidence?: "low" | "medium" | "high" | null;
          trunk_views_used?: string[]; trunk_geometric_assumption?: string | null; trunk_measurement_method?: "field_tape" | "frame_assisted_ai_estimate" | null;
          trunk_algorithm_version?: string | null; trunk_quality_flags?: unknown[];
          updated_at?: string;
        };
        Relationships: [{
          foreignKeyName: "capture_series_tree_sample_id_fkey"; columns: ["tree_sample_id"];
          referencedRelation: "tree_samples"; referencedColumns: ["id"];
        }];
      };
      capture_views: {
        Row: {
          id: string; capture_series_id: string; image_id: string; annotation_set_id: string | null; request_key: string;
          direction: "N" | "E" | "S" | "W"; active: boolean; replaces_view_id: string | null;
          processing_status: "uploaded" | "processing" | "repeat_photo" | "calibrated" | "annotation_pending" | "annotation_in_progress" | "annotation_completed" | "failed";
          template_version: string; algorithm_version: string; source: string; model_name: string; model_version: string | null;
          rectified_storage_path: string | null; union_mask_storage_path: string | null;
          valid_area_cm2: number | null; lichen_union_area_cm2: number | null; lichen_coverage_percent: number | null;
          component_count: number | null; occupied_cells: number | null; provisional_morphotype_richness: number | null;
          morphotype_coverage: Record<string, number>; reprojection_error_px: number | null; quality_score: number | null;
          quality_flags: unknown[]; confidence: number | null; processed_at: string | null; created_at: string; updated_at: string;
          rectified_width_px: number | null; rectified_height_px: number | null; valid_pixel_count: number | null;
          cm2_per_pixel: number | null; pixels_per_cm: number | null; calibration_method: "automatic" | "manual_confirmed" | "manual_provisional" | "legacy_four_view" | null;
          confirmed_corners: unknown[] | null; excluded_area_cm2: number | null;
          trunk_width_cm: number | null; trunk_width_min_cm: number | null; trunk_width_max_cm: number | null;
          trunk_left_x_normalized: number | null; trunk_right_x_normalized: number | null; trunk_scale_cm_per_pixel: number | null;
          trunk_estimation_method: "automatic" | "manual_corrected" | null; trunk_confidence: "low" | "medium" | "high" | null; trunk_quality_flags: unknown[];
        };
        Insert: {
          id?: string; capture_series_id: string; image_id: string; annotation_set_id?: string | null; request_key?: string;
          direction: "N" | "E" | "S" | "W"; active?: boolean; replaces_view_id?: string | null;
          processing_status?: "uploaded" | "processing" | "repeat_photo" | "calibrated" | "annotation_pending" | "annotation_in_progress" | "annotation_completed" | "failed";
          template_version?: string; algorithm_version: string; source?: string; model_name?: string; model_version?: string | null;
          rectified_storage_path?: string | null; union_mask_storage_path?: string | null;
          valid_area_cm2?: number | null; lichen_union_area_cm2?: number | null; lichen_coverage_percent?: number | null;
          component_count?: number | null; occupied_cells?: number | null; provisional_morphotype_richness?: number | null;
          morphotype_coverage?: Record<string, number>; reprojection_error_px?: number | null; quality_score?: number | null;
          quality_flags?: unknown[]; confidence?: number | null; processed_at?: string | null; created_at?: string; updated_at?: string;
          rectified_width_px?: number | null; rectified_height_px?: number | null; valid_pixel_count?: number | null;
          cm2_per_pixel?: number | null; pixels_per_cm?: number | null; calibration_method?: "automatic" | "manual_confirmed" | "manual_provisional" | "legacy_four_view" | null;
          confirmed_corners?: unknown[] | null; excluded_area_cm2?: number | null;
          trunk_width_cm?: number | null; trunk_width_min_cm?: number | null; trunk_width_max_cm?: number | null;
          trunk_left_x_normalized?: number | null; trunk_right_x_normalized?: number | null; trunk_scale_cm_per_pixel?: number | null;
          trunk_estimation_method?: "automatic" | "manual_corrected" | null; trunk_confidence?: "low" | "medium" | "high" | null; trunk_quality_flags?: unknown[];
        };
        Update: {
          annotation_set_id?: string | null; active?: boolean;
          processing_status?: "uploaded" | "processing" | "repeat_photo" | "calibrated" | "annotation_pending" | "annotation_in_progress" | "annotation_completed" | "failed";
          source?: string; model_name?: string; model_version?: string | null;
          rectified_storage_path?: string | null; union_mask_storage_path?: string | null;
          valid_area_cm2?: number | null; lichen_union_area_cm2?: number | null; lichen_coverage_percent?: number | null;
          component_count?: number | null; occupied_cells?: number | null; provisional_morphotype_richness?: number | null;
          morphotype_coverage?: Record<string, number>; reprojection_error_px?: number | null; quality_score?: number | null;
          quality_flags?: unknown[]; confidence?: number | null; processed_at?: string | null; updated_at?: string;
          rectified_width_px?: number | null; rectified_height_px?: number | null; valid_pixel_count?: number | null;
          cm2_per_pixel?: number | null; pixels_per_cm?: number | null; calibration_method?: "automatic" | "manual_confirmed" | "manual_provisional" | "legacy_four_view" | null;
          confirmed_corners?: unknown[] | null; excluded_area_cm2?: number | null;
          trunk_width_cm?: number | null; trunk_width_min_cm?: number | null; trunk_width_max_cm?: number | null;
          trunk_left_x_normalized?: number | null; trunk_right_x_normalized?: number | null; trunk_scale_cm_per_pixel?: number | null;
          trunk_estimation_method?: "automatic" | "manual_corrected" | null; trunk_confidence?: "low" | "medium" | "high" | null; trunk_quality_flags?: unknown[];
        };
        Relationships: [
          { foreignKeyName: "capture_views_capture_series_id_fkey"; columns: ["capture_series_id"]; referencedRelation: "capture_series"; referencedColumns: ["id"]; },
          { foreignKeyName: "capture_views_image_id_fkey"; columns: ["image_id"]; referencedRelation: "images"; referencedColumns: ["id"]; },
          { foreignKeyName: "capture_views_annotation_set_id_fkey"; columns: ["annotation_set_id"]; referencedRelation: "annotation_sets"; referencedColumns: ["id"]; }
        ];
      };
      annotation_sets: {
        Row: {
          id: string;
          image_id: string;
          method: "systematic_point_count" | "manual_free_points" | "ai_assisted_segmentation";
          status: string;
          version: number;
          grid_rows: number;
          grid_columns: number;
          roi_x: number | null;
          roi_y: number | null;
          roi_width: number | null;
          roi_height: number | null;
          notes: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
          capture_view_id: string | null;
          target_storage_path: string | null;
          target_width_px: number | null;
          target_height_px: number | null;
        };
        Insert: {
          image_id: string;
          method?: "systematic_point_count" | "manual_free_points" | "ai_assisted_segmentation";
          status?: string;
          version?: number;
          grid_rows: number;
          grid_columns: number;
          roi_x?: number | null;
          roi_y?: number | null;
          roi_width?: number | null;
          roi_height?: number | null;
          notes?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          capture_view_id?: string | null;
          target_storage_path?: string | null;
          target_width_px?: number | null;
          target_height_px?: number | null;
        };
        Update: {
          image_id?: string;
          method?: "systematic_point_count" | "manual_free_points" | "ai_assisted_segmentation";
          status?: string;
          version?: number;
          grid_rows?: number;
          grid_columns?: number;
          roi_x?: number | null;
          roi_y?: number | null;
          roi_width?: number | null;
          roi_height?: number | null;
          notes?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          capture_view_id?: string | null;
          target_storage_path?: string | null;
          target_width_px?: number | null;
          target_height_px?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "annotation_sets_image_id_fkey";
            columns: ["image_id"];
            referencedRelation: "images";
            referencedColumns: ["id"];
          }
        ];
      };
      morphotypes: {
        Row: {
          id: string;
          annotation_set_id: string;
          label: string;
          growth_form: string;
          color_hex: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          annotation_set_id: string;
          label: string;
          growth_form?: string;
          color_hex?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          annotation_set_id?: string;
          label?: string;
          growth_form?: string;
          color_hex?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "morphotypes_annotation_set_id_fkey";
            columns: ["annotation_set_id"];
            referencedRelation: "annotation_sets";
            referencedColumns: ["id"];
          }
        ];
      };
      annotation_points: {
        Row: {
          id: string;
          annotation_set_id: string;
          morphotype_id: string | null;
          point_index: number;
          x_normalized: number;
          y_normalized: number;
          classification: string;
          confidence_level: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          annotation_set_id: string;
          morphotype_id?: string | null;
          point_index: number;
          x_normalized: number;
          y_normalized: number;
          classification: string;
          confidence_level?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          annotation_set_id?: string;
          morphotype_id?: string | null;
          point_index?: number;
          x_normalized?: number;
          y_normalized?: number;
          classification?: string;
          confidence_level?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "annotation_points_annotation_set_id_fkey";
            columns: ["annotation_set_id"];
            referencedRelation: "annotation_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "annotation_points_morphotype_id_fkey";
            columns: ["morphotype_id"];
            referencedRelation: "morphotypes";
            referencedColumns: ["id"];
          }
        ];
      };
      annotation_regions: {
        Row: {
          id: string;
          annotation_set_id: string;
          classification: "lichen" | "bark" | "moss" | "algae" | "paint" | "damage" | "shadow" | "glare" | "unknown";
          morphotype_id: string | null;
          source: "mobile_sam" | "manual" | "color_assisted" | "automatic_four_view";
          model_name: string;
          model_version: string | null;
          confidence: number | null;
          algorithm_version: string | null;
          template_version: string | null;
          quality_flags: unknown[] | Record<string, unknown>;
          mask_bucket: string;
          mask_path: string;
          mask_width_px: number;
          mask_height_px: number;
          area_pixels: number;
          score: number | null;
          representative_color_hex: string | null;
          color_tolerance_delta_e: number | null;
          region_role: "trunk" | null;
          positive_points: unknown[];
          negative_points: unknown[];
          status: "draft" | "accepted" | "rejected";
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          annotation_set_id: string;
          classification: "lichen" | "bark" | "moss" | "algae" | "paint" | "damage" | "shadow" | "glare" | "unknown";
          morphotype_id?: string | null;
          source?: "mobile_sam" | "manual" | "color_assisted" | "automatic_four_view";
          model_name: string;
          model_version?: string | null;
          confidence?: number | null;
          algorithm_version?: string | null;
          template_version?: string | null;
          quality_flags?: unknown[] | Record<string, unknown>;
          mask_bucket?: string;
          mask_path: string;
          mask_width_px: number;
          mask_height_px: number;
          area_pixels: number;
          score?: number | null;
          representative_color_hex?: string | null;
          color_tolerance_delta_e?: number | null;
          region_role?: "trunk" | null;
          positive_points?: unknown[];
          negative_points?: unknown[];
          status?: "draft" | "accepted" | "rejected";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          annotation_set_id?: string;
          classification?: "lichen" | "bark" | "moss" | "algae" | "paint" | "damage" | "shadow" | "glare" | "unknown";
          morphotype_id?: string | null;
          source?: "mobile_sam" | "manual" | "color_assisted" | "automatic_four_view";
          model_name?: string;
          model_version?: string | null;
          confidence?: number | null;
          algorithm_version?: string | null;
          template_version?: string | null;
          quality_flags?: unknown[] | Record<string, unknown>;
          mask_bucket?: string;
          mask_path?: string;
          mask_width_px?: number;
          mask_height_px?: number;
          area_pixels?: number;
          score?: number | null;
          representative_color_hex?: string | null;
          color_tolerance_delta_e?: number | null;
          region_role?: "trunk" | null;
          positive_points?: unknown[];
          negative_points?: unknown[];
          status?: "draft" | "accepted" | "rejected";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "annotation_regions_annotation_set_id_fkey";
            columns: ["annotation_set_id"];
            referencedRelation: "annotation_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "annotation_regions_morphotype_fk";
            columns: ["morphotype_id", "annotation_set_id"];
            referencedRelation: "morphotypes";
            referencedColumns: ["id", "annotation_set_id"];
          }
        ];
      };
      annotation_metrics: {
        Row: {
          annotation_set_id: string;
          trunk_area_pixels: number | null;
          lichen_union_area_pixels: number | null;
          lichen_outside_trunk_pixels: number | null;
          overlapping_lichen_pixels: number | null;
          coverage_percent: number | null;
          accepted_region_count: number;
          lichen_region_count: number;
          morphotype_count: number;
          calculation_method: string;
          calculation_version: string;
          quality_flags: unknown[] | Record<string, unknown>;
          calculated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          annotation_set_id: string;
          trunk_area_pixels?: number | null;
          lichen_union_area_pixels?: number | null;
          lichen_outside_trunk_pixels?: number | null;
          overlapping_lichen_pixels?: number | null;
          coverage_percent?: number | null;
          accepted_region_count?: number;
          lichen_region_count?: number;
          morphotype_count?: number;
          calculation_method: string;
          calculation_version: string;
          quality_flags?: unknown[] | Record<string, unknown>;
          calculated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          annotation_set_id?: string;
          trunk_area_pixels?: number | null;
          lichen_union_area_pixels?: number | null;
          lichen_outside_trunk_pixels?: number | null;
          overlapping_lichen_pixels?: number | null;
          coverage_percent?: number | null;
          accepted_region_count?: number;
          lichen_region_count?: number;
          morphotype_count?: number;
          calculation_method?: string;
          calculation_version?: string;
          quality_flags?: unknown[] | Record<string, unknown>;
          calculated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "annotation_metrics_annotation_set_id_fkey";
            columns: ["annotation_set_id"];
            referencedRelation: "annotation_sets";
            referencedColumns: ["id"];
          }
        ];
      };
      site_environmental_contexts: {
        Row: {
          sampling_event_id: string;
          site_id: string;
          land_use_classification: string | null;
          is_reference_candidate: boolean | null;
          measured_at: string | null;
          provenance: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          sampling_event_id: string;
          site_id: string;
          land_use_classification?: string | null;
          is_reference_candidate?: boolean | null;
          measured_at?: string | null;
          provenance?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          sampling_event_id?: string;
          site_id?: string;
          land_use_classification?: string | null;
          is_reference_candidate?: boolean | null;
          measured_at?: string | null;
          provenance?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "site_environmental_contexts_site_id_fkey";
            columns: ["site_id"];
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "site_environmental_contexts_sampling_event_site_fk";
            columns: ["sampling_event_id", "site_id"];
            referencedRelation: "sampling_events";
            referencedColumns: ["id", "site_id"];
          }
        ];
      };
      tree_sample_scientific_contexts: {
        Row: {
          tree_sample_id: string;
          sampled_width_cm: number | null;
          sampled_height_cm: number | null;
          dbh_cm: number | null;
          bark_ph: number | null;
          bark_texture: string | null;
          canopy_cover_percent: number | null;
          air_temperature_c: number | null;
          relative_humidity_percent: number | null;
          measured_at: string | null;
          provenance: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tree_sample_id: string;
          sampled_width_cm?: number | null;
          sampled_height_cm?: number | null;
          dbh_cm?: number | null;
          bark_ph?: number | null;
          bark_texture?: string | null;
          canopy_cover_percent?: number | null;
          air_temperature_c?: number | null;
          relative_humidity_percent?: number | null;
          measured_at?: string | null;
          provenance?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tree_sample_id?: string;
          sampled_width_cm?: number | null;
          sampled_height_cm?: number | null;
          dbh_cm?: number | null;
          bark_ph?: number | null;
          bark_texture?: string | null;
          canopy_cover_percent?: number | null;
          air_temperature_c?: number | null;
          relative_humidity_percent?: number | null;
          measured_at?: string | null;
          provenance?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tree_sample_scientific_contexts_tree_sample_id_fkey";
            columns: ["tree_sample_id"];
            referencedRelation: "tree_samples";
            referencedColumns: ["id"];
          }
        ];
      };
      pollutant_measurements: {
        Row: {
          id: string;
          site_id: string;
          sampling_event_id: string | null;
          measured_at: string;
          pollutant_code: "PM2.5" | "PM10" | "NO2" | "SO2" | "NH3" | "O3" | "CO";
          value: number;
          unit_code: "ug_m3" | "mg_m3" | "ng_m3" | "ppm" | "ppb";
          averaging_period_minutes: number | null;
          instrument_method: string | null;
          data_source: string;
          qa_qc_status: "not_assessed" | "provisional" | "validated" | "rejected";
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          sampling_event_id?: string | null;
          measured_at: string;
          pollutant_code: "PM2.5" | "PM10" | "NO2" | "SO2" | "NH3" | "O3" | "CO";
          value: number;
          unit_code: "ug_m3" | "mg_m3" | "ng_m3" | "ppm" | "ppb";
          averaging_period_minutes?: number | null;
          instrument_method?: string | null;
          data_source: string;
          qa_qc_status?: "not_assessed" | "provisional" | "validated" | "rejected";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          sampling_event_id?: string | null;
          measured_at?: string;
          pollutant_code?: "PM2.5" | "PM10" | "NO2" | "SO2" | "NH3" | "O3" | "CO";
          value?: number;
          unit_code?: "ug_m3" | "mg_m3" | "ng_m3" | "ppm" | "ppb";
          averaging_period_minutes?: number | null;
          instrument_method?: string | null;
          data_source?: string;
          qa_qc_status?: "not_assessed" | "provisional" | "validated" | "rejected";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pollutant_measurements_site_id_fkey";
            columns: ["site_id"];
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pollutant_measurements_sampling_event_site_fk";
            columns: ["sampling_event_id", "site_id"];
            referencedRelation: "sampling_events";
            referencedColumns: ["id", "site_id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_or_create_capture_series: {
        Args: { p_tree_sample_id: string; p_algorithm_version: string; p_request_key: string; p_template_version?: string };
        Returns: Database["public"]["Tables"]["capture_series"]["Row"];
      };
      register_capture_view: {
        Args: { p_series_id: string; p_image_id: string; p_direction: string; p_algorithm_version: string; p_request_key: string };
        Returns: Database["public"]["Tables"]["capture_views"]["Row"];
      };
      confirm_capture_series: {
        Args: { p_series_id: string };
        Returns: Database["public"]["Tables"]["capture_series"]["Row"];
      };
      refresh_capture_series_metrics: {
        Args: { p_series_id: string };
        Returns: Database["public"]["Tables"]["capture_series"]["Row"];
      };
    };
  };
};
