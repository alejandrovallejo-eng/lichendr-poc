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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
