"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { extractExifMetadata, type ExtractedImageMetadata } from "@/modules/images/exif";
import { createSignedImageUrl, getImagesForTreeSample, ImagePersistenceError, persistImageWithMetadata, type ImageRecordRow, type ImageRecordWithAnnotationStatus, type ImageUploadProgress } from "@/modules/images/client";
import { ensureAnonymousSession } from "@/modules/auth/client";

interface ReviewImage {
  id: string;
  file: File;
  previewUrl: string;
  metadata: ExtractedImageMetadata;
  review: {
    latitude: string;
    longitude: string;
    gpsAccuracyM: string;
    notes: string;
    locationSource: "exif" | "gps" | "manual" | "unknown";
  };
  saveState: "idle" | "validating" | "uploading" | "saving-metadata" | "saved" | "error" | "cleanup-in-progress" | "cleanup-completed" | "cleanup-pending";
  saveError?: string;
  progress?: number;
  canRetry?: boolean;
  savedRecord?: ImageRecordRow;
  signedUrl?: string;
}

function formatMetadataState(metadata: ExtractedImageMetadata) {
  if (metadata.hasExif) {
    return "Se encontraron metadatos EXIF";
  }

  if (metadata.warning) {
    return metadata.warning;
  }

  return "No se encontraron metadatos EXIF";
}

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/tiff", "image/webp"]);

function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function validateImageFile(file: File) {
  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  const mimeIsKnown = ALLOWED_IMAGE_TYPES.has(file.type);
  const extensionIsKnown = ALLOWED_IMAGE_EXTENSIONS.has(extension);
  const hasAcceptableType = mimeIsKnown || extensionIsKnown;

  if (!hasAcceptableType) {
    return { valid: false, message: "Formato no admitido. Usa JPG, JPEG, PNG, HEIC, HEIF, TIFF o WEBP." };
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, message: "El archivo supera el límite de 20 MB." };
  }

  return { valid: true };
}

function getLocationSourceLabel(locationSource: ReviewImage["review"]["locationSource"]) {
  switch (locationSource) {
    case "exif":
      return "EXIF";
    case "gps":
      return "GPS";
    case "manual":
      return "Manual";
    default:
      return "Sin fuente";
  }
}

function getSaveStateLabel(saveState: ReviewImage["saveState"]) {
  switch (saveState) {
    case "saved":
      return "Guardada";
    case "uploading":
      return "Subiendo";
    case "saving-metadata":
      return "Guardando metadata";
    case "validating":
      return "Validando";
    case "cleanup-in-progress":
      return "Limpieza en curso";
    case "cleanup-completed":
      return "Limpieza completada";
    case "cleanup-pending":
      return "Limpieza pendiente";
    case "error":
    default:
      return "Error";
  }
}

export default function ImagesWorkflow() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? undefined;
  const siteId = searchParams.get("siteId") ?? undefined;
  const eventId = searchParams.get("eventId") ?? undefined;
  const treeSampleId = searchParams.get("treeSampleId") ?? undefined;

  const [images, setImages] = useState<ReviewImage[]>([]);
  const [savedImages, setSavedImages] = useState<ImageRecordWithAnnotationStatus[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const loadSavedImages = async () => {
      if (!treeSampleId) {
        setSavedImages([]);
        return;
      }

      try {
        const records = await getImagesForTreeSample(treeSampleId);
        setSavedImages(records);
      } catch {
        setSavedImages([]);
      }
    };

    void loadSavedImages();

    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
    };
  }, [treeSampleId]);

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const currentKeys = new Set(images.map((image) => getFileKey(image.file)));
    const pendingFiles = files.filter((file) => !currentKeys.has(getFileKey(file)));
    const skippedCount = files.length - pendingFiles.length;

    if (pendingFiles.length === 0) {
      setSelectionNotice(skippedCount > 0 ? "No se añadieron archivos porque ya estaban cargados." : "No se seleccionaron archivos válidos.");
      event.target.value = "";
      return;
    }

    setLoadingFiles(true);
    setSelectionNotice("Se están leyendo los archivos locales y sus metadatos EXIF. No se suben ni se guardan datos todavía.");

    const nextImages = await Promise.all(
      pendingFiles.map(async (file) => {
        const validation = validateImageFile(file);
        if (!validation.valid) {
          return null;
        }

        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.push(previewUrl);
        const metadata = await extractExifMetadata(file);

        return {
          id: `${getFileKey(file)}-${previewUrl}`,
          file,
          previewUrl,
          metadata,
          review: {
            latitude: metadata.latitude != null ? String(metadata.latitude) : "",
            longitude: metadata.longitude != null ? String(metadata.longitude) : "",
            gpsAccuracyM: metadata.gpsAccuracyM != null ? String(metadata.gpsAccuracyM) : "",
            notes: "",
            locationSource: metadata.locationSource,
          },
          saveState: "idle",
        } as ReviewImage;
      })
    );

    const parsedImages = nextImages.filter((image): image is ReviewImage => image != null);
    if (parsedImages.length === 0) {
      setSelectionNotice("No se añadieron archivos. Revisa el formato o el tamaño antes de intentarlo de nuevo.");
      setLoadingFiles(false);
      event.target.value = "";
      return;
    }

    setImages((current) => [...current, ...parsedImages]);
    setLoadingFiles(false);
    if (parsedImages.length < pendingFiles.length) {
      setSelectionNotice("Algunos archivos no se añadieron porque no pasaron la validación de formato o tamaño.");
    } else if (skippedCount > 0) {
      setSelectionNotice("Los archivos válidos se añadieron; los duplicados se ignoraron.");
    } else {
      setSelectionNotice("Archivos listos para revisar. No se suben ni se guardan datos todavía.");
    }
    event.target.value = "";
  };

  const updateImageField = (imageId: string, field: keyof ReviewImage["review"], value: string) => {
    setImages((current) =>
      current.map((image) => {
        if (image.id !== imageId) {
          return image;
        }

        const nextReview = { ...image.review, [field]: value };
        const fieldIsLatitude = field === "latitude";
        const fieldIsLongitude = field === "longitude";
        const nextLatitude = fieldIsLatitude ? value : image.review.latitude;
        const nextLongitude = fieldIsLongitude ? value : image.review.longitude;
        const latitudePresent = nextLatitude.trim() !== "";
        const longitudePresent = nextLongitude.trim() !== "";

        if ((fieldIsLatitude || fieldIsLongitude) && latitudePresent !== longitudePresent) {
          setSelectionNotice("Latitud y longitud deben estar ambas presentes o ambas ausentes para mantener una ubicación válida.");
          return image;
        }

        const nextLocationSource = latitudePresent || longitudePresent ? "manual" : "unknown";

        return {
          ...image,
          review: {
            ...nextReview,
            locationSource: nextLocationSource,
          },
        };
      })
    );
  };

  const handleUseDeviceLocation = (imageId: string) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setSelectionNotice("La geolocalización no está disponible en este navegador.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setImages((current) =>
          current.map((image) => {
            if (image.id !== imageId) {
              return image;
            }

            return {
              ...image,
              review: {
                ...image.review,
                latitude: String(position.coords.latitude),
                longitude: String(position.coords.longitude),
                gpsAccuracyM: position.coords.accuracy != null ? String(position.coords.accuracy) : image.review.gpsAccuracyM,
                locationSource: "gps",
              },
            };
          })
        );
      },
      (error) => {
        setSelectionNotice(`No se pudo leer la ubicación del dispositivo: ${error.message}`);
      }
    );
  };

  const removeImage = (imageId: string) => {
    setImages((current) => {
      const targetImage = current.find((image) => image.id === imageId);
      if (targetImage) {
        URL.revokeObjectURL(targetImage.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== targetImage.previewUrl);
      }

      return current.filter((image) => image.id !== imageId);
    });
  };

  const handlePersistImages = async (targetImageId?: string) => {
    if (!treeSampleId) {
      setSelectionNotice("Selecciona un tree_sample antes de guardar imágenes.");
      return;
    }

    const pendingImages = images.filter((image) => targetImageId ? image.id === targetImageId : image.saveState !== "saved" && image.saveState !== "cleanup-pending");
    if (pendingImages.length === 0) {
      setSelectionNotice("No hay imágenes pendientes por guardar.");
      return;
    }

    setIsSavingBatch(true);
    setSaveSuccessMessage(null);

    for (const [index, image] of pendingImages.entries()) {
      const latitude = Number(image.review.latitude);
      const longitude = Number(image.review.longitude);
      const gpsAccuracyM = image.review.gpsAccuracyM.trim() === "" ? undefined : Number(image.review.gpsAccuracyM);
      const hasValidCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
      const numericValuesValid = image.review.gpsAccuracyM.trim() === "" || Number.isFinite(gpsAccuracyM);

      if (!hasValidCoordinates || !numericValuesValid) {
        setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "error", saveError: "Latitud/longitud o precisión GPS inválidos." } : entry));
        continue;
      }

      setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "validating", saveError: undefined } : entry));
      const sessionResult = await ensureAnonymousSession();
      if (sessionResult.error || !sessionResult.session) {
        setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "error", saveError: sessionResult.error ?? "No se pudo obtener una sesión." } : entry));
        continue;
      }

      try {
        setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "uploading", progress: 0, canRetry: false } : entry));
        const nextLocationSource: ExtractedImageMetadata["locationSource"] = image.review.locationSource === "manual"
          ? "manual"
          : image.review.locationSource === "gps"
            ? "gps"
            : hasValidCoordinates
              ? "exif"
              : "unknown";
        const nextMetadata: ExtractedImageMetadata = {
          ...image.metadata,
          latitude,
          longitude,
          gpsAccuracyM: gpsAccuracyM ?? undefined,
          locationSource: nextLocationSource,
        };

        setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "cleanup-in-progress", progress: 0, canRetry: false } : entry));
        const persistedRecord = await persistImageWithMetadata(
          image.file,
          {
            projectId: projectId ?? "",
            siteId: siteId ?? "",
            eventId: eventId ?? "",
            treeSampleId,
          },
          nextMetadata,
          image.review.notes || "",
          index + 1,
          (progress: ImageUploadProgress) => {
            setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "uploading", progress: progress.percent } : entry));
          }
        );

        setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "saving-metadata", progress: 100, canRetry: false } : entry));
        const signedUrl = await createSignedImageUrl(persistedRecord.storage_path);
        setImages((current) => current.map((entry) => entry.id === image.id ? { ...entry, saveState: "saved", progress: 100, savedRecord: persistedRecord, signedUrl, canRetry: false } : entry));
        setSavedImages((current) => [{ ...persistedRecord, annotationStatus: "not_started" }, ...current]);
      } catch (error) {
        const cleanupError = error instanceof ImagePersistenceError ? error : null;
        const nextState = cleanupError?.phase === "upload"
          ? "error"
          : cleanupError?.cleanup.canRetry
            ? "cleanup-completed"
            : "cleanup-pending";
        setImages((current) => current.map((entry) => entry.id === image.id ? {
          ...entry,
          saveState: cleanupError ? nextState : "error",
          saveError: cleanupError ? cleanupError.cleanup.userMessage : error instanceof Error ? error.message : "No se pudo guardar la imagen.",
          canRetry: cleanupError ? cleanupError.cleanup.canRetry : true,
          progress: 100,
        } : entry));
      }
    }

    setIsSavingBatch(false);
    if (pendingImages.length > 0) {
      const savedCount = pendingImages.filter((image) => image.saveState === "saved").length;
      if (savedCount > 0) {
        setSaveSuccessMessage("La imagen y su metadata fueron guardadas correctamente.");
      }
    }
  };

  const retryImageSave = async (imageId: string) => {
    const targetImage = images.find((image) => image.id === imageId);
    if (!targetImage) {
      return;
    }

    setImages((current) => current.map((entry) => entry.id === imageId ? { ...entry, saveState: "validating", saveError: undefined, progress: 0, canRetry: false } : entry));
    await handlePersistImages(imageId);
  };

  return (
    <div>
      <PageHeader title="Imágenes" subtitle="Revisa y corrige metadatos EXIF de forma local antes de cualquier carga o persistencia." />

      <section className="mb-6 rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
        <p className="text-sm">
          Este flujo está pensado para el trabajo de campo: puedes seleccionar archivos locales, inspeccionar su previsualización y revisar
          la metadata asociada sin subir nada a Supabase todavía.
        </p>
        <div className="mt-3 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
          {projectId || siteId || eventId || treeSampleId ? (
            <p>
              Contexto activo: {projectId ? `proyecto ${projectId}` : "sin proyecto"}; {siteId ? `sitio ${siteId}` : "sin sitio"}; {eventId ? `jornada ${eventId}` : "sin jornada"}; {treeSampleId ? `muestreo ${treeSampleId}` : "sin muestreo"}
            </p>
          ) : (
            <p>No hay contexto de árbol o muestreo seleccionado; puedes revisar imágenes de forma independiente.</p>
          )}
        </div>
      </section>

      <section className="mb-6 rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>Seleccionar imágenes locales</h2>
            <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Acepta múltiples archivos .jpg/.jpeg/.png para previsualizarlos y revisar sus metadatos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handlePersistImages()}
              disabled={isSavingBatch || images.filter((image) => image.saveState !== "saved").length === 0 || !treeSampleId}
              className="rounded border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--ld-border)", background: "var(--ld-sand)", color: "var(--ld-text)" }}
            >
              {isSavingBatch ? "Guardando..." : "Guardar imágenes en Supabase"}
            </button>
            <label className="inline-flex cursor-pointer items-center justify-center rounded border px-4 py-2" style={{ borderColor: "var(--ld-border)", background: "var(--ld-sand)", color: "var(--ld-text)" }}>
              <span>{loadingFiles ? "Leyendo archivos..." : "Elegir imágenes"}</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelection} />
            </label>
          </div>
        </div>

        {selectionNotice ? (
          <div className="mt-4 rounded border px-4 py-3 text-sm" style={{ background: "#f8f9fa", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
            {selectionNotice}
          </div>
        ) : null}

        {saveSuccessMessage ? (
          <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm" style={{ color: "#166534" }}>
            {saveSuccessMessage}
          </div>
        ) : null}
      </section>

      {images.length === 0 ? (
        <section className="rounded border p-6 text-center" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
          <p>Aún no hay imágenes para revisar.</p>
          <p className="mt-2 text-sm">Usa el selector para cargar archivos desde tu equipo.</p>
        </section>
      ) : (
        <div className="space-y-4">
          {images.map((image) => (
            <section key={image.id} className="rounded border p-4" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
              <div className="flex flex-col gap-4 lg:flex-row">
                <div className="lg:w-1/3">
                  <Image src={image.previewUrl} alt={image.file.name} width={800} height={600} unoptimized className="h-64 w-full rounded object-cover" />
                  <div className="mt-3 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                    <p className="font-medium" style={{ color: "var(--ld-text)" }}>{image.file.name}</p>
                    <p>{image.file.type || "Tipo no informado"}</p>
                    <p className="mt-1">{formatMetadataState(image.metadata)}</p>
                  </div>
                </div>

                <div className="flex-1 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Revisión de metadatos</h3>
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Puedes corregir los valores mostrados antes de cualquier carga futura.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="rounded border px-3 py-1 text-sm"
                      style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}
                    >
                      Quitar
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                      <p className="mb-1 text-sm font-medium" style={{ color: "var(--ld-text)" }}>Fecha EXIF</p>
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{image.metadata.capturedAtLocal ?? "No disponible"}</p>
                      <p className="mt-1 text-xs" style={{ color: "var(--ld-text-secondary)" }}>
                        {image.metadata.capturedAt ? "UTC calculada desde el offset" : "Sin offset válido para convertir a UTC"}
                      </p>
                    </div>

                    <div className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                      <p className="mb-1 text-sm font-medium" style={{ color: "var(--ld-text)" }}>Cámara / modelo</p>
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{image.metadata.camera ?? "No disponible"}</p>
                    </div>

                    <div className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                      <p className="mb-1 text-sm font-medium" style={{ color: "var(--ld-text)" }}>Estado de guardado</p>
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{getSaveStateLabel(image.saveState)}</p>
                      {image.progress != null ? <p className="mt-1 text-xs" style={{ color: "var(--ld-text-secondary)" }}>{image.progress}%</p> : null}
                      {image.saveError ? <p className="mt-2 text-xs" style={{ color: "#b91c1c" }}>{image.saveError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor={`${image.id}-latitude`}>
                        Latitud
                      </label>
                      <input
                        id={`${image.id}-latitude`}
                        type="text"
                        value={image.review.latitude}
                        onChange={(event) => updateImageField(image.id, "latitude", event.target.value)}
                        className="w-full rounded border px-3 py-2"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor={`${image.id}-longitude`}>
                        Longitud
                      </label>
                      <input
                        id={`${image.id}-longitude`}
                        type="text"
                        value={image.review.longitude}
                        onChange={(event) => updateImageField(image.id, "longitude", event.target.value)}
                        className="w-full rounded border px-3 py-2"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor={`${image.id}-gps-accuracy`}>
                        Precisión GPS (m)
                      </label>
                      <input
                        id={`${image.id}-gps-accuracy`}
                        type="text"
                        value={image.review.gpsAccuracyM}
                        onChange={(event) => updateImageField(image.id, "gpsAccuracyM", event.target.value)}
                        className="w-full rounded border px-3 py-2"
                        style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                      />
                    </div>

                    <div className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                      <p className="mb-1 text-sm font-medium" style={{ color: "var(--ld-text)" }}>Fuente de ubicación</p>
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{getLocationSourceLabel(image.review.locationSource)}</p>
                      <button
                        type="button"
                        onClick={() => handleUseDeviceLocation(image.id)}
                        className="mt-2 rounded border px-3 py-1 text-sm"
                        style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}
                      >
                        Usar GPS del dispositivo
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium" style={{ color: "var(--ld-text)" }} htmlFor={`${image.id}-notes`}>
                      Notas de revisión
                    </label>
                    <textarea
                      id={`${image.id}-notes`}
                      rows={3}
                      value={image.review.notes}
                      onChange={(event) => updateImageField(image.id, "notes", event.target.value)}
                      className="w-full rounded border px-3 py-2"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    />
                  </div>

                  {(image.saveState === "error" || image.saveState === "cleanup-completed" || image.saveState === "cleanup-pending") ? (
                    <button type="button" onClick={() => void retryImageSave(image.id)} disabled={!image.canRetry} className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                      Reintentar
                    </button>
                  ) : null}

                  {process.env.NODE_ENV === "development" ? (
                    <div className="rounded border p-3" style={{ borderColor: "var(--ld-border)" }}>
                      <button type="button" onClick={() => setShowDiagnostics((current) => !current)} className="text-sm font-medium" style={{ color: "var(--ld-text)" }}>
                        {showDiagnostics ? "Ocultar" : "Mostrar"} Diagnóstico EXIF
                      </button>
                      {showDiagnostics ? (
                        <div className="mt-3 grid gap-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                          <p><strong>DateTimeOriginal encontrado:</strong> {image.metadata.diagnostics?.dateTimeOriginalFound ? "sí" : "no"}</p>
                          <p><strong>CreateDate encontrado:</strong> {image.metadata.diagnostics?.createDateFound ? "sí" : "no"}</p>
                          <p><strong>OffsetTimeOriginal encontrado:</strong> {image.metadata.diagnostics?.offsetTimeOriginalFound ? "sí" : "no"}</p>
                          <p><strong>GPSLatitude encontrado:</strong> {image.metadata.diagnostics?.gpsLatitudeFound ? "sí" : "no"}</p>
                          <p><strong>GPSLongitude encontrado:</strong> {image.metadata.diagnostics?.gpsLongitudeFound ? "sí" : "no"}</p>
                          <p><strong>resultado exifr.gps válido:</strong> {image.metadata.diagnostics?.gpsResultValid ? "sí" : "no"}</p>
                          {image.metadata.diagnostics?.parserError ? <p><strong>Errores del parser:</strong> {image.metadata.diagnostics.parserError}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      <section className="mt-6 rounded border p-4" style={{ background: "#f8f9fa", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
        <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Imágenes guardadas</h3>
        {savedImages.length === 0 ? (
          <p className="mt-2 text-sm">Aún no hay imágenes guardadas para este tree_sample.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {savedImages.map((savedImage) => (
              <div key={savedImage.id} className="rounded border bg-white p-3" style={{ borderColor: "var(--ld-border)" }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium" style={{ color: "var(--ld-text)" }}>{savedImage.original_filename}</p>
                  <span className="rounded-full border px-2 py-1 text-xs font-medium" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                    {savedImage.annotationStatus === "completed" ? "Evaluada" : savedImage.annotationStatus === "draft" ? "Borrador" : "Sin evaluar"}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--ld-text-secondary)" }}>{savedImage.caption ?? "Sin caption"}</p>
                <p className="mt-2 text-xs" style={{ color: "var(--ld-text-secondary)" }}>Orden: {savedImage.image_order}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--ld-text-secondary)" }}>Creada: {new Date(savedImage.created_at).toLocaleString()}</p>
                <Link href={`/annotations?imageId=${savedImage.id}`} className="mt-3 inline-flex rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--ld-border)", color: "var(--ld-text)" }}>
                  {savedImage.annotationStatus === "completed" ? "Ver evaluación" : savedImage.annotationStatus === "draft" ? "Continuar anotación" : "Anotar imagen"}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded border p-4" style={{ background: "#f8f9fa", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}>
        <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>Notas de privacidad y método</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>Las coordenadas EXIF se usan solo para revisión local y luego para persistir en Supabase con el mismo contexto de la imagen.</li>
          <li>Las URLs de visualización se generan con signed URLs privadas y el bucket sigue sin ser público.</li>
          <li>El flujo guarda imágenes y metadata en Supabase, pero no realiza análisis visual ni mapas.</li>
        </ul>
      </section>
    </div>
  );
}
