"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AnnotationStudio from "@/modules/annotations/AnnotationStudio";
import AnnotationImageBrowser from "@/modules/annotations/AnnotationImageBrowser";
import {
  ensureAnnotationSetForImage,
  getSignedImageUrl,
  listAnnotationImages,
  loadAnnotationState,
  type AnnotationImageListItem,
  type AnnotationMetricsRow,
  type AnnotationSetRow,
  type MorphotypeRow,
} from "@/modules/annotations/client";

interface AnnotationStudioWorkflowProps {
  initialImageId: string | null;
  initialTool: "manual" | "ai" | "layers";
  captureSeriesId?: string;
  captureViewIndex?: number;
}

export default function AnnotationStudioWorkflow({
  initialImageId,
  initialTool,
  captureSeriesId,
  captureViewIndex = 0,
}: AnnotationStudioWorkflowProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestIdRef = useRef(0);
  const [images, setImages] = useState<AnnotationImageListItem[]>([]);
  const [image, setImage] = useState<AnnotationImageListItem | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [annotationSet, setAnnotationSet] = useState<AnnotationSetRow | null>(null);
  const [morphotypes, setMorphotypes] = useState<MorphotypeRow[]>([]);
  const [metrics, setMetrics] = useState<AnnotationMetricsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadImage = useCallback(async (imageId: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const [available, state] = await Promise.all([
        listAnnotationImages(),
        loadAnnotationState(imageId),
      ]);
      const storedImage = available.find((item) => item.id === imageId);
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
      setImages(available.map((item) => item.id === imageId ? {
        ...item,
        annotationSetId: activeSet.id,
        annotationStatus: activeSet.status === "completed" && activeSet.completed_at ? "completed" : "draft",
        completedAt: activeSet.completed_at,
      } : item));
      setImageUrl(signedUrl);
      setAnnotationSet(activeSet);
      setMorphotypes(state.morphotypes);
      setMetrics(state.metrics);
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
      const available = await listAnnotationImages();
      if (requestId === requestIdRef.current) setImages(available);
    } catch {
      if (requestId === requestIdRef.current) setError("No se pudieron cargar las imágenes disponibles.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (initialImageId) void loadImage(initialImageId);
      else void loadImages();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
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
    return <AnnotationImageBrowser images={images} initialTab={searchParams.get("tab") === "evaluated" ? "evaluated" : "pending"} initialTool={initialTool} />;
  }

  return (
    <AnnotationStudio
      key={image.id}
      imageId={image.id}
      imageUrl={imageUrl}
      imageName={image.original_filename}
      annotationSetId={annotationSet.id}
      annotationStatus={annotationSet.status === "completed" && annotationSet.completed_at ? "completed" : "draft"}
      completedAt={annotationSet.completed_at}
      imageContext={image.context}
      initialMorphotypes={morphotypes}
      initialMetrics={metrics}
      roi={{
        x: annotationSet.roi_x,
        y: annotationSet.roi_y,
        width: annotationSet.roi_width,
        height: annotationSet.roi_height,
      }}
      initialTool={initialTool}
      onChooseAnotherImage={() => router.push(captureSeriesId
        ? `/annotations?captureSeriesId=${encodeURIComponent(captureSeriesId)}&view=${captureViewIndex}&tool=${initialTool}`
        : `/annotations?tool=${initialTool}`)}
      onMorphotypesChange={setMorphotypes}
      onAnnotationSetChange={(nextSet) => {
        setAnnotationSet(nextSet);
        setImages((current) => current.map((item) => item.id === image.id ? {
          ...item,
          annotationSetId: nextSet.id,
          annotationStatus: nextSet.status === "completed" && nextSet.completed_at ? "completed" : "draft",
          completedAt: nextSet.completed_at,
        } : item));
      }}
      onViewEvaluated={() => router.push("/annotations?tab=evaluated")}
      onGoToAnalysis={() => {
        const params = new URLSearchParams({
          projectId: image.context.projectId,
          siteId: image.context.siteId,
          samplingEventId: image.context.samplingEventId,
          treeSampleId: image.context.treeSampleId,
        });
        router.push(`/analysis?${params.toString()}`);
      }}
      onEvaluateNext={async () => {
        if (captureSeriesId) {
          if (captureViewIndex < 3) {
            router.push(`/annotations?captureSeriesId=${encodeURIComponent(captureSeriesId)}&view=${captureViewIndex + 1}&tool=ai`);
          } else {
            router.push(`/analysis?captureSeriesId=${encodeURIComponent(captureSeriesId)}`);
          }
          return true;
        }
        const available = await listAnnotationImages();
        const pending = available
          .filter((item) => item.id !== image.id && item.annotationStatus !== "completed")
          .sort((left, right) => {
            const priority = (item: AnnotationImageListItem) => {
              if (item.context.treeSampleId === image.context.treeSampleId) return 0;
              if (item.context.samplingEventId === image.context.samplingEventId) return 1;
              if (item.context.siteId === image.context.siteId) return 2;
              return 3;
            };
            const priorityDifference = priority(left) - priority(right);
            if (priorityDifference !== 0) return priorityDifference;
            const sampleDifference = left.context.treeSampleId.localeCompare(right.context.treeSampleId);
            if (sampleDifference !== 0) return sampleDifference;
            if (left.image_order !== right.image_order) return left.image_order - right.image_order;
            return left.created_at.localeCompare(right.created_at);
          });
        const next = pending[0];
        if (!next) return false;
        router.push(`/annotations?imageId=${encodeURIComponent(next.id)}&tool=${initialTool}`);
        return true;
      }}
    />
  );
}
