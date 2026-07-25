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
  latitude: number;
  longitude: number;
  altitude?: number;
  createdAt: string;
}

export interface SamplingEvent {
  id: UUID;
  siteId: UUID;
  date: string; // ISO date
  observer?: string;
  notes?: string;
}

export interface Tree {
  id: UUID;
  siteId: UUID;
  tag?: string; // physical tag on tree
  species?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

export interface TreeSample {
  id: UUID;
  treeId: UUID;
  samplingEventId: UUID;
  sampleNumber?: number;
  notes?: string;
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
