"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AnnotationStudio from "@/modules/annotations/AnnotationStudio";
import {
  ensureAnnotationSetForImage,
  getImageRecord,
  getSignedImageUrl,
  listAccessibleImages,
  loadAnnotationState,
  type AccessibleImageRecord,
  type AnnotationSetRow,
  type MorphotypeRow,
} from "@/modules/annotations/client";

interface AnnotationStudioWorkflowProps {
  initialImageId: string | null;
  initialTool: "manual" | "ai" | "layers";
}

export default function AnnotationStudioWorkflow({ initialImageId, initialTool }: AnnotationStudioWorkflowProps) {
  const router = useRouter();
  const requestIdRef = useRef(0);
  const [images, setImages] = useState<AccessibleImageRecord[]>([]);
  const [image, setImage] = useState<AccessibleImageRecord | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [annotationSet, setAnnotationSet] = useState<AnnotationSetRow | null>(null);
  const [morphotypes, setMorphotypes] = useState<MorphotypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadImage = useCallback(async (imageId: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const [storedImage, state] = await Promise.all([
        getImageRecord(imageId),
        loadAnnotationState(imageId),
      ]);
      if (!storedImage) throw new Error("No se encontró la imagen.");
      const activeSet = state.annotationSet ?? await ensureAnnotationSetForImage(imageId, {
        method: "manual_free_points",
        status: "draft",
        gridRows: 10,
        gridColumns: 10,
        roiX: 0,
        roiY: 0,
        roiWidth: 1,
        roiHeight: 1,
      });
      const signedUrl = await getSignedImageUrl(storedImage.storage_path);
      if (requestId !== requestIdRef.current) return;
      setImage(storedImage);
      setImageUrl(signedUrl);
      setAnnotationSet(activeSet);
      setMorphotypes(state.morphotypes);
    } catch {
      if (requestId === requestIdRef.current) {
        setError("No se pudo cargar la imagen o su conjunto de anotación.");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const loadImages = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const available = await listAccessibleImages();
      if (requestId === requestIdRef.current) setImages(available);
    } catch {
      if (requestId === requestIdRef.current) setError("No se pudieron cargar las imágenes disponibles.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialImageId) void loadImage(initialImageId);
    else void loadImages();
    return () => {
      requestIdRef.current += 1;
    };
  }, [initialImageId, loadImage, loadImages]);

  if (loading) {
    return <div className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>Cargando Annotation Studio…</div>;
  }

  if (error) {
    return <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (!initialImageId || !image || !imageUrl || !annotationSet) {
    return (
      <div>
        <header className="mb-4">
          <h1 className="text-xl font-semibold">Annotation Studio</h1>
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>Selecciona una fotografía guardada para definir el tronco y sus regiones.</p>
        </header>
        <div className="grid gap-3 md:grid-cols-2">
          {images.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => router.push(`/annotations?imageId=${encodeURIComponent(item.id)}`)}
              className="rounded border bg-white p-4 text-left focus-visible:outline-2"
              style={{ borderColor: "var(--ld-border)" }}
            >
              <strong>{item.original_filename}</strong>
              <span className="mt-1 block text-sm" style={{ color: "var(--ld-text-secondary)" }}>{new Date(item.created_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
        {images.length === 0 ? <p className="rounded border p-4 text-sm" style={{ borderColor: "var(--ld-border)" }}>No hay imágenes guardadas disponibles.</p> : null}
      </div>
    );
  }

  return (
    <AnnotationStudio
      imageUrl={imageUrl}
      imageName={image.original_filename}
      annotationSetId={annotationSet.id}
      initialMorphotypes={morphotypes}
      roi={{
        x: annotationSet.roi_x,
        y: annotationSet.roi_y,
        width: annotationSet.roi_width,
        height: annotationSet.roi_height,
      }}
      initialTool={initialTool}
      onChooseAnotherImage={() => router.push("/annotations")}
      onMorphotypesChange={setMorphotypes}
    />
  );
}
