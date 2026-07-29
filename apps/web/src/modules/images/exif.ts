import exifr from "exifr";

export interface ExtractedImageMetadata {
  hasExif: boolean;
  source: "exif" | "manual" | "none";
  capturedAt?: string;
  capturedAtLocal?: string;
  camera?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  width?: number;
  height?: number;
  warning?: string;
  locationSource: "exif" | "gps" | "manual" | "unknown";
}

function parseExifDateTime(value: unknown): { capturedAt?: string; capturedAtLocal?: string } | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  const match = trimmedValue.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):?(\d{2}))?$/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second, fractionalSeconds, offsetSign, offsetHours, offsetMinutes] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  const millisecondNumber = fractionalSeconds ? Number(fractionalSeconds.padEnd(3, "0")) : 0;

  const localDateTime = `${yearNumber.toString().padStart(4, "0")}-${monthNumber.toString().padStart(2, "0")}-${dayNumber.toString().padStart(2, "0")}T${hourNumber.toString().padStart(2, "0")}:${minuteNumber.toString().padStart(2, "0")}:${secondNumber.toString().padStart(2, "0")}`;

  if (!offsetSign) {
    return {
      capturedAtLocal: localDateTime,
    };
  }

  const offsetValue = Number(offsetHours) * 60 + Number(offsetMinutes);
  const offsetMinutesTotal = offsetSign === "-" ? -offsetValue : offsetValue;
  const utcTimestamp = Date.UTC(
    yearNumber,
    monthNumber - 1,
    dayNumber,
    hourNumber,
    minuteNumber,
    secondNumber,
    millisecondNumber
  ) - offsetMinutesTotal * 60 * 1000;

  return {
    capturedAt: new Date(utcTimestamp).toISOString(),
    capturedAtLocal: `${localDateTime}${offsetSign}${offsetHours}:${offsetMinutes}`,
  };
}

function normalizeCamera(make: unknown, model: unknown): string | undefined {
  const parts = [make, model].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
}

export async function extractExifMetadata(file: File): Promise<ExtractedImageMetadata> {
  try {
    const rawMetadata = await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "Model",
        "Make",
        "GPSLatitude",
        "GPSLongitude",
        "GPSHPositioningError",
        "ImageWidth",
        "ImageHeight",
      ],
    });

    const parsedDate = parseExifDateTime(rawMetadata?.DateTimeOriginal ?? rawMetadata?.CreateDate);
    const capturedAt = parsedDate?.capturedAt;
    const capturedAtLocal = parsedDate?.capturedAtLocal;
    const camera = normalizeCamera(rawMetadata?.Make, rawMetadata?.Model);
    const latitude = typeof rawMetadata?.GPSLatitude === "number" ? rawMetadata.GPSLatitude : undefined;
    const longitude = typeof rawMetadata?.GPSLongitude === "number" ? rawMetadata.GPSLongitude : undefined;
    const gpsAccuracyM = typeof rawMetadata?.GPSHPositioningError === "number" ? rawMetadata.GPSHPositioningError : undefined;
    const width = typeof rawMetadata?.ImageWidth === "number" ? rawMetadata.ImageWidth : undefined;
    const height = typeof rawMetadata?.ImageHeight === "number" ? rawMetadata.ImageHeight : undefined;
    const locationSource = latitude != null && longitude != null ? "exif" : "unknown";

    if (capturedAt || capturedAtLocal || camera || latitude != null || longitude != null || gpsAccuracyM != null || width != null || height != null) {
      return {
        hasExif: true,
        source: "exif",
        capturedAt,
        capturedAtLocal,
        camera,
        latitude,
        longitude,
        gpsAccuracyM,
        width,
        height,
        locationSource,
      };
    }

    return {
      hasExif: false,
      source: "none",
      warning: "No se encontraron metadatos EXIF útiles en esta imagen.",
      locationSource: "unknown",
    };
  } catch (error) {
    return {
      hasExif: false,
      source: "none",
      warning: error instanceof Error ? error.message : "No se pudo extraer EXIF desde el archivo.",
      locationSource: "unknown",
    };
  }
}
