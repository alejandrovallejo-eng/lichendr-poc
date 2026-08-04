// Domain types for LichenDR v1 (initial)

export type UUID = string;

export interface Project {
  id: UUID;
  name: string;
  description?: string;
  createdAt: string; // ISO date
}

export interface Site {
  id: UUID;
  projectId: UUID;
  name: string;
  description?: string;
  province?: string;
  municipality?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  locationSource: "unknown" | "manual" | "exif" | "gps";
  radiusM: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SamplingEvent {
  id: UUID;
  siteId: UUID;
  name: string;
  sampledAt: string; // ISO datetime
  observerNames?: string;
  weatherNotes?: string;
  protocolVersion: string;
  status: "draft" | "completed";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tree {
  id: UUID;
  siteId: UUID;
  code: string;
  speciesName?: string;
  speciesConfidence: "unknown" | "low" | "medium" | "high";
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  locationSource: "unknown" | "manual" | "exif" | "gps";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TreeSample {
  id: UUID;
  siteId: UUID;
  samplingEventId: UUID;
  treeId: UUID;
  substrateType: "tree_bark" | "dead_wood" | "rock" | "soil" | "concrete" | "other" | "unknown";
  trunkOrientation: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "multiple" | "unknown";
  samplingHeightM?: number;
  shadeLevel: "unknown" | "low" | "medium" | "high";
  confidenceLevel: "unknown" | "low" | "medium" | "high";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageMetadata {
  id: UUID;
  filename: string;
  width?: number;
  height?: number;
  capturedAt?: string; // ISO
  camera?: string;
}

export interface ImageRecord {
  id: UUID;
  treeSampleId?: UUID;
  image: ImageMetadata;
  uri?: string; // storage or local path
}

export interface AnnotationSet {
  id: UUID;
  imageId: UUID;
  method: "systematic_point_count" | "manual_free_points";
  status: "draft" | "completed";
  version: number;
  gridRows: number;
  gridColumns: number;
  roiX: number | null;
  roiY: number | null;
  roiWidth: number | null;
  roiHeight: number | null;
  notes?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  annotator?: string;
  morphotypes: Morphotype[];
}

export interface Morphotype {
  id: UUID;
  annotationSetId: UUID;
  label: string;
  growthForm: "crustose" | "foliose" | "fruticose" | "squamulose" | "unknown";
  colorHex?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationPoint {
  id: UUID;
  annotationSetId: UUID;
  morphotypeId?: UUID | null;
  pointIndex: number;
  xNormalized: number;
  yNormalized: number;
  classification: "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
  confidenceLevel: "low" | "medium" | "high";
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRegion {
  id: UUID;
  annotationSetId: UUID;
  classification: "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
  morphotypeId?: UUID | null;
  source: "mobile_sam";
  modelName: string;
  modelVersion?: string | null;
  maskBucket: string;
  maskPath: string;
  maskWidthPx: number;
  maskHeightPx: number;
  areaPixels: number;
  score?: number | null;
  positivePoints: unknown[];
  negativePoints: unknown[];
  status: "draft" | "accepted" | "rejected";
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisRun {
  id: UUID;
  inputAnnotationSetIds: UUID[];
  createdAt: string;
  algorithm?: string;
  version?: string;
  resultSummary?: Record<string, unknown>;
}

export interface EnvironmentalEstimate {
  id: UUID;
  analysisRunId: UUID;
  siteId?: UUID;
  value?: number; // placeholder numeric index
  units?: string;
  createdAt: string;
}
