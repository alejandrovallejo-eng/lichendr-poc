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
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          name: string;
          description?: string | null;
          country_code?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          owner_id?: string;
          name?: string;
          description?: string | null;
          country_code?: string;
          status?: string;
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
          classification: "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
          morphotype_id: string | null;
          source: "mobile_sam";
          model_name: string;
          model_version: string | null;
          mask_bucket: string;
          mask_path: string;
          mask_width_px: number;
          mask_height_px: number;
          area_pixels: number;
          score: number | null;
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
          classification: "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
          morphotype_id?: string | null;
          source?: "mobile_sam";
          model_name: string;
          model_version?: string | null;
          mask_bucket?: string;
          mask_path: string;
          mask_width_px: number;
          mask_height_px: number;
          area_pixels: number;
          score?: number | null;
          positive_points?: unknown[];
          negative_points?: unknown[];
          status?: "draft" | "accepted" | "rejected";
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          annotation_set_id?: string;
          classification?: "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
          morphotype_id?: string | null;
          source?: "mobile_sam";
          model_name?: string;
          model_version?: string | null;
          mask_bucket?: string;
          mask_path?: string;
          mask_width_px?: number;
          mask_height_px?: number;
          area_pixels?: number;
          score?: number | null;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
