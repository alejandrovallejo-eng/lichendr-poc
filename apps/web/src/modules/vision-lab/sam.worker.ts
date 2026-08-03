/// <reference lib="webworker" />

import { env } from "@huggingface/transformers";
import type {
  BackendPreference,
  ImageInferencePayload,
  PointPrompt,
  RuntimeBackend,
  SegmentationCandidate,
  WorkerErrorStage,
  WorkerMessage,
  WorkerRequest,
} from "./types";

const MODEL_ID = "Xenova/slimsam-77-uniform";

interface ProcessorLike {
  (image: unknown, options?: { input_points?: number[][][]; input_labels?: number[][] }): Promise<Record<string, unknown>>;
  post_process_masks?: (
    predMasks: unknown,
    originalSizes: Array<[number, number]>,
    reshapedInputSizes: Array<[number, number]>,
  ) => Promise<unknown[]>;
}

interface ModelLike {
  (inputs: Record<string, unknown>): Promise<{
    pred_masks: unknown;
    iou_scores?: { data?: Float32Array | ArrayLike<number> };
  }>;
  get_image_embeddings: (args: { pixel_values: unknown }) => Promise<{
    image_embeddings: unknown;
    image_positional_embeddings: unknown;
  }>;
}

type PrepareJob = Extract<WorkerRequest, { type: "prepare-image" }>;
type SegmentJob = Extract<WorkerRequest, { type: "segment" }>;
type LoadJob = Extract<WorkerRequest, { type: "load" }>;

let model: ModelLike | null = null;
let processor: ProcessorLike | null = null;
let ready = false;
let activeBackend: RuntimeBackend | null = null;
let loadAttemptInProgress = false;
let webGpuFallbackUsed = false;

let cachedImageEmbeddings: unknown = null;
let cachedImagePositionalEmbeddings: unknown = null;
let cachedPreparedImage: unknown = null;
let cachedImageKey: string | null = null;

let latestSessionId = "";
let pendingPrepare: PrepareJob | null = null;
let pendingSegment: SegmentJob | null = null;
let runningJob: Promise<void> | null = null;

function postWorkerMessage(message: WorkerMessage) {
  self.postMessage(message);
}

function disposeUnknown(resource: unknown) {
  if (!resource || typeof resource !== "object") {
    return;
  }

  const maybeResource = resource as { dispose?: () => void; delete?: () => void };

  if (typeof maybeResource.dispose === "function") {
    try {
      maybeResource.dispose();
    } catch {
      // Ignore best-effort resource cleanup errors.
    }
  }

  if (typeof maybeResource.delete === "function") {
    try {
      maybeResource.delete();
    } catch {
      // Ignore best-effort resource cleanup errors.
    }
  }
}

function clearImageCache() {
  disposeUnknown(cachedImageEmbeddings);
  disposeUnknown(cachedImagePositionalEmbeddings);
  disposeUnknown(cachedPreparedImage);
  cachedImageEmbeddings = null;
  cachedImagePositionalEmbeddings = null;
  cachedPreparedImage = null;
  cachedImageKey = null;
}

function createSanitizedError(stage: WorkerErrorStage, error: unknown) {
  const defaultMessage = {
    "decode-image": "No fue posible leer la imagen seleccionada.",
    "preprocess-image": "No fue posible preparar la imagen para el modelo.",
    "encode-image": "No fue posible calcular los embeddings de imagen.",
    "prepare-prompts": "No fue posible preparar los puntos guia para el modelo.",
    "decode-mask": "No fue posible decodificar la mascara propuesta.",
    "postprocess-mask": "No fue posible postprocesar la mascara propuesta.",
  } satisfies Record<WorkerErrorStage, string>;

  const name = error instanceof Error && error.name ? error.name : "Error";

  return { stage, name, message: defaultMessage[stage] };
}

function isWebGpuAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function isSafariBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const agent = navigator.userAgent.toLowerCase();
  const isSafari = agent.includes("safari");
  const isChromium = agent.includes("chrome") || agent.includes("crios") || agent.includes("edg") || agent.includes("android");
  return isSafari && !isChromium;
}

function isFatalWebGpuError(error: unknown) {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const normalized = raw.toLowerCase();

  return normalized.includes("device lost")
    || normalized.includes("webgpu")
    || normalized.includes("gpu")
    || normalized.includes("out of memory")
    || normalized.includes("fatal");
}

function resolveBackendOrder(preference: BackendPreference): RuntimeBackend[] {
  if (preference === "wasm") {
    return ["wasm"];
  }

  if (preference === "webgpu") {
    return isWebGpuAvailable() ? ["webgpu", "wasm"] : ["wasm"];
  }

  if (isSafariBrowser()) {
    return ["wasm", "webgpu"];
  }

  return isWebGpuAvailable() ? ["webgpu", "wasm"] : ["wasm"];
}

function messageForBackend(backend: RuntimeBackend) {
  return backend === "webgpu" ? "Backend activo: WebGPU" : "Backend activo: WASM";
}

async function configureWasmBackend() {
  const wasmBackend = env.backends.onnx.wasm;
  if (!wasmBackend) {
    return;
  }

  wasmBackend.wasmPaths = {
    wasm: "/onnx-runtime/ort-wasm-simd-threaded.asyncify.wasm",
    mjs: "/onnx-runtime/ort-wasm-simd-threaded.asyncify.mjs",
  };

  if (typeof wasmBackend.numThreads === "number") {
    wasmBackend.numThreads = Math.max(1, Math.min(2, wasmBackend.numThreads || 2));
  }

  if (typeof wasmBackend.proxy === "boolean") {
    wasmBackend.proxy = false;
  }
}

async function loadModelWithBackend(backend: RuntimeBackend, request: LoadJob) {
  const { AutoProcessor, SamModel } = await import("@huggingface/transformers");

  await configureWasmBackend();

  const modelInstance = await SamModel.from_pretrained(MODEL_ID, {
    device: backend,
    progress_callback: (progressInfo: { status?: string; file?: string; progress?: number }) => {
      const fileName = progressInfo.file ?? "modelo";
      const percent = typeof progressInfo.progress === "number" ? Math.round(progressInfo.progress) : 0;
      postWorkerMessage({
        type: "progress",
        sessionId: request.sessionId,
        requestId: request.requestId,
        message: `Preparando motor de IA... ${fileName}: ${percent}% | backend: ${backend}`,
      });
    },
  });

  const processorInstance = await AutoProcessor.from_pretrained(MODEL_ID);
  return { modelInstance, processorInstance };
}

async function loadModel(request: LoadJob, forcedBackend?: RuntimeBackend) {
  if (loadAttemptInProgress) {
    return;
  }

  loadAttemptInProgress = true;
  env.allowLocalModels = false;

  const backendOrder = forcedBackend ? [forcedBackend] : resolveBackendOrder(request.backendPreference);
  let lastError: Error | null = null;

  disposeUnknown(model);
  disposeUnknown(processor);
  model = null;
  processor = null;
  ready = false;
  activeBackend = null;
  clearImageCache();

  try {
    for (const backend of backendOrder) {
      try {
        postWorkerMessage({
          type: "progress",
          sessionId: request.sessionId,
          requestId: request.requestId,
          message: `Preparando motor de IA... intentando ${backend.toUpperCase()}`,
        });

        const loaded = await loadModelWithBackend(backend, request);
        model = loaded.modelInstance as unknown as ModelLike;
        processor = loaded.processorInstance as unknown as ProcessorLike;
        ready = true;
        activeBackend = backend;

        postWorkerMessage({
          type: "ready",
          sessionId: request.sessionId,
          requestId: request.requestId,
          backend,
          message: messageForBackend(backend),
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("No se pudo cargar el modelo.");
        disposeUnknown(model);
        disposeUnknown(processor);
        model = null;
        processor = null;
        ready = false;
        activeBackend = null;
        clearImageCache();
      }
    }

    throw lastError ?? new Error("No se pudo inicializar el modelo.");
  } finally {
    loadAttemptInProgress = false;
  }
}

function buildPromptPayload(points: PointPrompt[]) {
  if (points.length === 0) {
    return { input_points: [] as number[][][], input_labels: [] as number[][] };
  }

  return {
    input_points: [points.map((point) => [point.x, point.y])] as number[][][],
    input_labels: [points.map((point) => point.label)] as number[][],
  };
}

function decodeMaskTensor(maskTensor: unknown): { mask: number[][]; width: number; height: number } {
  const tensor = maskTensor as { dims?: number[]; data?: Uint8Array | Uint8ClampedArray | Float32Array | ArrayLike<number> };
  const dims = tensor.dims ?? [];

  let width = 0;
  let height = 0;

  if (dims.length === 2) {
    height = dims[0] ?? 0;
    width = dims[1] ?? 0;
  } else if (dims.length === 3) {
    height = dims[1] ?? 0;
    width = dims[2] ?? 0;
  } else if (dims.length >= 4) {
    height = dims[2] ?? 0;
    width = dims[3] ?? 0;
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Dimensiones de mascara invalidas.");
  }

  const data = Array.from(tensor.data ?? []);
  const grid: number[][] = [];

  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = data[index] ?? 0;
      row.push(value > 0 ? 1 : 0);
    }
    grid.push(row);
  }

  return { mask: grid, width, height };
}

function imageCacheKey(imageData: ImageInferencePayload, sessionId: string) {
  return `${sessionId}:${imageData.imageKey}:${imageData.inferenceWidth}:${imageData.inferenceHeight}`;
}

function isCurrentSession(sessionId: string) {
  return sessionId === latestSessionId;
}

async function prepareImage(job: PrepareJob) {
  if (!ready || !model || !processor) {
    throw createSanitizedError("preprocess-image", new Error("El modelo aun no esta listo."));
  }

  const { RawImage } = await import("@huggingface/transformers");
  const key = imageCacheKey(job.image, job.sessionId);

  postWorkerMessage({
    type: "image-processing",
    sessionId: job.sessionId,
    requestId: job.requestId,
    operation: "preparing-image",
    message: "Preparando imagen...",
  });

  let rawImage: unknown = null;

  try {
    rawImage = await RawImage.fromBlob(job.image.blob);
    const resized = await (rawImage as { resize: (width: number, height: number) => Promise<unknown> }).resize(
      job.image.inferenceWidth,
      job.image.inferenceHeight,
    );

    disposeUnknown(cachedPreparedImage);
    cachedPreparedImage = resized;

    const imageInputs = await processor(cachedPreparedImage);
    const pixelValues = imageInputs.pixel_values;
    if (!pixelValues) {
      throw new Error("No se pudieron extraer los valores de pixel de la imagen.");
    }

    if (cachedImageKey !== key || !cachedImageEmbeddings || !cachedImagePositionalEmbeddings) {
      disposeUnknown(cachedImageEmbeddings);
      disposeUnknown(cachedImagePositionalEmbeddings);

      const embeddings = await model.get_image_embeddings({ pixel_values: pixelValues });
      cachedImageEmbeddings = embeddings.image_embeddings;
      cachedImagePositionalEmbeddings = embeddings.image_positional_embeddings;
      cachedImageKey = key;
    }

    if (!isCurrentSession(job.sessionId)) {
      return;
    }

    postWorkerMessage({
      type: "image-ready",
      sessionId: job.sessionId,
      requestId: job.requestId,
      message: "Imagen lista: haz clic sobre la region que deseas incluir.",
    });
  } catch (error) {
    clearImageCache();
    throw createSanitizedError("preprocess-image", error);
  } finally {
    disposeUnknown(rawImage);
  }
}

async function runInference(job: SegmentJob) {
  if (!ready || !model || !processor) {
    throw createSanitizedError("preprocess-image", new Error("El modelo aun no esta listo."));
  }

  if (job.points.length === 0) {
    return;
  }

  const key = imageCacheKey(job.image, job.sessionId);
  if (cachedImageKey !== key || !cachedImageEmbeddings || !cachedImagePositionalEmbeddings || !cachedPreparedImage) {
    throw createSanitizedError("prepare-prompts", new Error("La imagen no esta preparada para segmentacion."));
  }

  postWorkerMessage({
    type: "image-processing",
    sessionId: job.sessionId,
    requestId: job.requestId,
    operation: "segmenting",
    message: "Generando mascara...",
  });

  try {
    const { input_points, input_labels } = buildPromptPayload(job.points);
    if (input_points.length === 0 || input_labels.length === 0) {
      throw createSanitizedError("prepare-prompts", new Error("No hay puntos guia disponibles."));
    }

    const inputs = await processor(cachedPreparedImage, {
      input_points,
      input_labels,
    });

    const outputs = await model({
      ...inputs,
      image_embeddings: cachedImageEmbeddings,
      image_positional_embeddings: cachedImagePositionalEmbeddings,
    });

    const masks = await (processor.post_process_masks?.(
      outputs.pred_masks,
      inputs.original_sizes as Array<[number, number]>,
      inputs.reshaped_input_sizes as Array<[number, number]>,
    ) ?? []);

    const candidates: SegmentationCandidate[] = [];
    const scoreTensor = outputs.iou_scores;

    for (let index = 0; index < masks.length; index += 1) {
      const decodedMask = decodeMaskTensor(masks[index]);
      candidates.push({
        id: `${job.requestId}-${index}`,
        score: Number(scoreTensor?.data?.[index] ?? 0),
        mask: decodedMask.mask,
        width: decodedMask.width,
        height: decodedMask.height,
      });
    }

    if (!isCurrentSession(job.sessionId)) {
      return;
    }

    candidates.sort((left, right) => right.score - left.score);
    postWorkerMessage({
      type: "mask-ready",
      sessionId: job.sessionId,
      requestId: job.requestId,
      masks: candidates,
      points: job.points,
    });
  } catch (error) {
    const sanitizedError = error instanceof Error && "stage" in error ? error : createSanitizedError("postprocess-mask", error);
    throw sanitizedError;
  }
}

async function withWebGpuFallback<T>(job: PrepareJob | SegmentJob, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (activeBackend === "webgpu" && !webGpuFallbackUsed && isFatalWebGpuError(error)) {
      webGpuFallbackUsed = true;
      await loadModel(
        {
          type: "load",
          sessionId: job.sessionId,
          requestId: job.requestId,
          backendPreference: "wasm",
        },
        "wasm",
      );
      return action();
    }

    throw error;
  }
}

function postErrorFromUnknown(job: PrepareJob | SegmentJob | LoadJob, fallbackStage: WorkerErrorStage, error: unknown) {
  const typedError = error as { stage?: WorkerErrorStage; name?: string; message?: string };
  const sanitized = createSanitizedError(fallbackStage, error);

  postWorkerMessage({
    type: "error",
    sessionId: job.sessionId,
    requestId: job.requestId,
    stage: typedError.stage ?? sanitized.stage,
    name: typedError.name ?? sanitized.name,
    message: typedError.message ?? sanitized.message,
  });
}

function scheduleJobs() {
  if (runningJob) {
    return;
  }

  runningJob = (async () => {
    while (true) {
      if (pendingPrepare) {
        const prepareJob = pendingPrepare;
        pendingPrepare = null;
        try {
          await withWebGpuFallback(prepareJob, async () => {
            await prepareImage(prepareJob);
          });
        } catch (error) {
          postErrorFromUnknown(prepareJob, "preprocess-image", error);
        }
        continue;
      }

      if (pendingSegment) {
        const segmentJob = pendingSegment;
        pendingSegment = null;
        try {
          await withWebGpuFallback(segmentJob, async () => {
            await runInference(segmentJob);
          });
        } catch (error) {
          postErrorFromUnknown(segmentJob, "postprocess-mask", error);
        }
        continue;
      }

      break;
    }
  })().finally(() => {
    runningJob = null;
    if (pendingPrepare || pendingSegment) {
      scheduleJobs();
    }
  });
}

function handleLoadRequest(request: LoadJob) {
  postWorkerMessage({
    type: "loading",
    sessionId: request.sessionId,
    requestId: request.requestId,
    message: "Preparando motor de IA...",
  });

  loadModel(request).catch((error) => {
    postErrorFromUnknown(request, "preprocess-image", error);
  });
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (!message?.type) {
    return;
  }

  if (message.type === "load") {
    handleLoadRequest(message);
    return;
  }

  if (message.type === "abort-session") {
    if (message.sessionId === latestSessionId) {
      pendingPrepare = null;
      pendingSegment = null;
      clearImageCache();
    }
    return;
  }

  if (message.type === "prepare-image") {
    latestSessionId = message.sessionId;
    pendingPrepare = message;
    pendingSegment = null;
    scheduleJobs();
    return;
  }

  if (message.type === "segment") {
    if (message.sessionId !== latestSessionId) {
      return;
    }

    pendingSegment = message;
    scheduleJobs();
  }
});
