export type WorkerMessageType =
  | "loading"
  | "progress"
  | "ready"
  | "image-processing"
  | "image-ready"
  | "mask-ready"
  | "error";

export type WorkerRequestType = "load" | "prepare-image" | "segment" | "abort-session";

export type BackendPreference = "auto" | "webgpu" | "wasm";
export type RuntimeBackend = "webgpu" | "wasm";

export type WorkerErrorStage =
  | "decode-image"
  | "preprocess-image"
  | "encode-image"
  | "prepare-prompts"
  | "decode-mask"
  | "postprocess-mask";

export interface BaseWorkerMessage {
  type: WorkerMessageType;
  sessionId: string;
  requestId: number;
}

export interface LoadingWorkerMessage extends BaseWorkerMessage {
  type: "loading";
  message: string;
}

export interface ProgressWorkerMessage extends BaseWorkerMessage {
  type: "progress";
  message: string;
}

export interface ReadyWorkerMessage extends BaseWorkerMessage {
  type: "ready";
  message: string;
  backend: RuntimeBackend;
}

export interface ImageProcessingWorkerMessage extends BaseWorkerMessage {
  type: "image-processing";
  message: string;
  operation: "preparing-image" | "segmenting";
}

export interface ImageReadyWorkerMessage extends BaseWorkerMessage {
  type: "image-ready";
  message: string;
}

export interface MaskReadyWorkerMessage extends BaseWorkerMessage {
  type: "mask-ready";
  masks: SegmentationCandidate[];
  points: PointPrompt[];
}

export interface ErrorWorkerMessage extends BaseWorkerMessage {
  type: "error";
  stage: WorkerErrorStage;
  name: string;
  message: string;
}

export type WorkerMessage =
  | LoadingWorkerMessage
  | ProgressWorkerMessage
  | ReadyWorkerMessage
  | ImageProcessingWorkerMessage
  | ImageReadyWorkerMessage
  | MaskReadyWorkerMessage
  | ErrorWorkerMessage;

export interface PointPrompt {
  x: number;
  y: number;
  label: 1 | 0;
}

export interface SegmentationCandidate {
  id: string;
  score: number;
  mask: number[][];
  maskDataUrl?: string;
  width: number;
  height: number;
}

export interface AcceptedMask {
  id: string;
  className: "lichen" | "bark" | "moss" | "algae" | "shadow" | "glare" | "unknown";
  morphotypeName?: string;
  pixels: number;
  score: number;
  model: string;
  modelVersion?: string;
  createdAt: string;
  width: number;
  height: number;
  mask: number[][];
}

export interface ImageAsset {
  src: string;
  blob?: Blob;
  mimeType?: string;
  imageKey?: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  inferenceWidth: number;
  inferenceHeight: number;
  orientation?: number;
}

export interface ImageInferencePayload {
  imageKey: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  inferenceWidth: number;
  inferenceHeight: number;
}

export interface BaseWorkerRequest {
  type: WorkerRequestType;
  sessionId: string;
  requestId: number;
}

export interface LoadWorkerRequest extends BaseWorkerRequest {
  type: "load";
  backendPreference: BackendPreference;
}

export interface PrepareImageWorkerRequest extends BaseWorkerRequest {
  type: "prepare-image";
  image: ImageInferencePayload;
}

export interface SegmentWorkerRequest extends BaseWorkerRequest {
  type: "segment";
  image: ImageInferencePayload;
  points: PointPrompt[];
}

export interface AbortSessionWorkerRequest extends BaseWorkerRequest {
  type: "abort-session";
}

export type WorkerRequest =
  | LoadWorkerRequest
  | PrepareImageWorkerRequest
  | SegmentWorkerRequest
  | AbortSessionWorkerRequest;
