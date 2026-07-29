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
  createdAt: string;
  annotator?: string;
  // simple structure for now
  morphotypes: Morphotype[];
}

export interface Morphotype {
  id: UUID;
  label: string;
  confidence?: number; // 0..1
  bbox?: { x: number; y: number; w: number; h: number };
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
