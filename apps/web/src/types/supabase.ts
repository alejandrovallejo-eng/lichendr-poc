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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
