import exifr from "exifr";

export interface ExtractedImageMetadata {
  hasExif: boolean;
  source: "exif" | "manual" | "none";
  capturedAt?: string;
  capturedAtLocal?: string;
  timezoneOffset?: string;
  camera?: string;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  orientation?: number;
  focalLengthMm?: number;
  apertureFNumber?: number;
  exposureTimeSeconds?: number;
  isoSpeed?: number;
  software?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  width?: number;
  height?: number;
  warning?: string;
  locationSource: "exif" | "gps" | "manual" | "unknown";
  rawExif?: Record<string, unknown>;
  diagnostics?: {
    dateTimeOriginalFound: boolean;
    createDateFound: boolean;
    offsetTimeOriginalFound: boolean;
    gpsLatitudeFound: boolean;
    gpsLongitudeFound: boolean;
    gpsResultValid: boolean;
    parserError?: string;
  };
}

interface ParsedMetadataRecord {
  [key: string]: unknown;
}

interface GpsCoordinateResult {
  latitude?: unknown;
  longitude?: unknown;
}

type DateSource = "DateTimeOriginal" | "CreateDate" | "DateTimeDigitized" | "ModifyDate" | "none";

function parseExifDateTime(value: unknown, offsetValue?: unknown): { capturedAt?: string; capturedAtLocal?: string; dateSource: DateSource } | undefined {
  if (value instanceof Date) {
    return {
      capturedAtLocal: value.toISOString(),
      dateSource: "none",
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      capturedAtLocal: new Date(value).toISOString(),
      dateSource: "none",
    };
  }

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

  const offsetValueText = offsetSign ? `${offsetSign}${offsetHours}:${offsetMinutes}` : undefined;
  if (!offsetSign && offsetValue == null) {
    return {
      capturedAtLocal: `${localDateTime}`,
      dateSource: "none",
    };
  }

  const offsetMatch = String(offsetValue ?? offsetValueText ?? "").trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  const offsetMinutesValue = offsetMatch
    ? Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])
    : undefined;

  if (offsetMatch == null || offsetMinutesValue == null) {
    return {
      capturedAtLocal: `${localDateTime}`,
      dateSource: "none",
    };
  }

  const offsetMinutesTotal = offsetMatch[1] === "-" ? -offsetMinutesValue : offsetMinutesValue;
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
    capturedAtLocal: `${localDateTime}${offsetMatch[1]}${offsetMatch[2]}:${offsetMatch[3]}`,
    dateSource: "none",
  };
}

function normalizeCamera(make: unknown, model: unknown): { camera?: string; cameraMake?: string; cameraModel?: string } {
  const parts = [make, model].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  if (parts.length === 0) {
    return {};
  }

  const cameraMake = typeof make === "string" && make.trim() !== "" ? make.trim() : undefined;
  const cameraModel = typeof model === "string" && model.trim() !== "" ? model.trim() : undefined;

  return {
    camera: parts.join(" "),
    cameraMake,
    cameraModel,
  };
}

function sanitizeRawExifValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRawExifValue(item));
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const sanitizedEntries = Object.entries(candidate).reduce<Record<string, unknown>>((accumulator, [key, entryValue]) => {
      if (key === "MakerNote" || key === "UserComment" || key === "SerialNumber" || key === "OwnerName" || key === "Artist" || key === "XPAuthor" || key === "XPTitle" || key === "XPComment") {
        return accumulator;
      }

      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return accumulator;
      }

      accumulator[normalizedKey] = sanitizeRawExifValue(entryValue);
      return accumulator;
    }, {});

    return sanitizedEntries;
  }

  return String(value);
}

function sanitizeRawExif(rawMetadata: ParsedMetadataRecord): Record<string, unknown> | undefined {
  const allowedKeys = new Set([
    "DateTimeOriginal",
    "CreateDate",
    "DateTimeDigitized",
    "ModifyDate",
    "OffsetTimeOriginal",
    "OffsetTimeDigitized",
    "OffsetTime",
    "Make",
    "Model",
    "LensModel",
    "Orientation",
    "FocalLength",
    "FocalLengthIn35mmFormat",
    "ApertureValue",
    "ExposureTime",
    "ISOSpeedRatings",
    "Software",
    "GPSLatitude",
    "GPSLongitude",
    "GPSLatitudeRef",
    "GPSLongitudeRef",
    "GPSHPositioningError",
    "ImageWidth",
    "ImageHeight",
  ]);

  const sanitizedEntries = Object.entries(rawMetadata).reduce<Record<string, unknown>>((accumulator, [key, value]) => {
    if (!allowedKeys.has(key)) {
      return accumulator;
    }

    accumulator[key] = sanitizeRawExifValue(value);
    return accumulator;
  }, {});

  return Object.keys(sanitizedEntries).length > 0 ? sanitizedEntries : undefined;
}

function normalizeGpsValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }

  if (Array.isArray(value) && value.length === 3) {
    const [degrees, minutes, seconds] = value.map((item) => (typeof item === "number" ? item : Number(item)));
    if ([degrees, minutes, seconds].every((item) => Number.isFinite(item))) {
      return degrees + minutes / 60 + seconds / 3600;
    }
  }

  if (typeof value === "object" && value !== null) {
    const candidate = value as { degrees?: unknown; minutes?: unknown; seconds?: unknown; decimal?: unknown };
    if (typeof candidate.decimal === "number" && Number.isFinite(candidate.decimal)) {
      return candidate.decimal;
    }

    const degrees = typeof candidate.degrees === "number" ? candidate.degrees : Number(candidate.degrees);
    const minutes = typeof candidate.minutes === "number" ? candidate.minutes : Number(candidate.minutes);
    const seconds = typeof candidate.seconds === "number" ? candidate.seconds : Number(candidate.seconds);

    if ([degrees, minutes, seconds].every((item) => Number.isFinite(item))) {
      return degrees + minutes / 60 + seconds / 3600;
    }
  }

  return undefined;
}

function normalizeGpsCoordinate(value: unknown, reference: unknown): number | undefined {
  const normalizedValue = normalizeGpsValue(value);
  if (normalizedValue == null) {
    return undefined;
  }

  const normalizedReference = typeof reference === "string" ? reference.trim().toUpperCase() : undefined;
  if (normalizedReference === "S" || normalizedReference === "W") {
    return -normalizedValue;
  }

  return normalizedValue;
}

function isValidLatitude(value: number | undefined): value is number {
  return value != null && value >= -90 && value <= 90;
}

function isValidLongitude(value: number | undefined): value is number {
  return value != null && value >= -180 && value <= 180;
}

export async function extractExifMetadata(file: File): Promise<ExtractedImageMetadata> {
  try {
    const rawMetadata = (await exifr.parse(file)) as ParsedMetadataRecord | undefined;
    const gpsMetadata = (await exifr.gps(file)) as GpsCoordinateResult | undefined;

    const dateValue = rawMetadata?.DateTimeOriginal ?? rawMetadata?.CreateDate ?? rawMetadata?.DateTimeDigitized ?? rawMetadata?.ModifyDate;
    const offsetValue = rawMetadata?.OffsetTimeOriginal ?? rawMetadata?.OffsetTimeDigitized ?? rawMetadata?.OffsetTime;
    const parsedDate = parseExifDateTime(dateValue, offsetValue);

    const capturedAt = parsedDate?.capturedAt;
    const capturedAtLocal = parsedDate?.capturedAtLocal;
    const cameraInfo = normalizeCamera(rawMetadata?.Make, rawMetadata?.Model);
    const timezoneOffset = typeof offsetValue === "string" && offsetValue.trim() !== "" ? offsetValue.trim() : undefined;
    const lensModel = typeof rawMetadata?.LensModel === "string" && rawMetadata.LensModel.trim() !== "" ? rawMetadata.LensModel.trim() : undefined;
    const orientation = typeof rawMetadata?.Orientation === "number" ? rawMetadata.Orientation : undefined;
    const focalLengthMm = typeof rawMetadata?.FocalLength === "number" ? rawMetadata.FocalLength : typeof rawMetadata?.FocalLengthIn35mmFormat === "number" ? rawMetadata.FocalLengthIn35mmFormat : undefined;
    const apertureFNumber = typeof rawMetadata?.ApertureValue === "number" ? rawMetadata.ApertureValue : undefined;
    const exposureTimeSeconds = typeof rawMetadata?.ExposureTime === "number" ? rawMetadata.ExposureTime : undefined;
    const isoSpeed = typeof rawMetadata?.ISOSpeedRatings === "number" ? rawMetadata.ISOSpeedRatings : undefined;
    const software = typeof rawMetadata?.Software === "string" && rawMetadata.Software.trim() !== "" ? rawMetadata.Software.trim() : undefined;
    const gpsLatitude = normalizeGpsCoordinate(gpsMetadata?.latitude, "N");
    const gpsLongitude = normalizeGpsCoordinate(gpsMetadata?.longitude, "E");
    const parsedLatitude = normalizeGpsCoordinate(
      rawMetadata?.GPSLatitude ?? rawMetadata?.latitude,
      rawMetadata?.GPSLatitudeRef ?? rawMetadata?.latitudeRef
    );
    const parsedLongitude = normalizeGpsCoordinate(
      rawMetadata?.GPSLongitude ?? rawMetadata?.longitude,
      rawMetadata?.GPSLongitudeRef ?? rawMetadata?.longitudeRef
    );

    const latitude = gpsLatitude ?? parsedLatitude;
    const longitude = gpsLongitude ?? parsedLongitude;
    const gpsAccuracyM = typeof rawMetadata?.GPSHPositioningError === "number" ? rawMetadata.GPSHPositioningError : undefined;
    const width = typeof rawMetadata?.ImageWidth === "number" ? rawMetadata.ImageWidth : undefined;
    const height = typeof rawMetadata?.ImageHeight === "number" ? rawMetadata.ImageHeight : undefined;
    const locationSource = isValidLatitude(latitude) && isValidLongitude(longitude) ? "exif" : "unknown";
    const rawExif = sanitizeRawExif(rawMetadata ?? {});

    const diagnostics = {
      dateTimeOriginalFound: rawMetadata?.DateTimeOriginal != null,
      createDateFound: rawMetadata?.CreateDate != null,
      offsetTimeOriginalFound: rawMetadata?.OffsetTimeOriginal != null,
      gpsLatitudeFound: gpsLatitude != null || parsedLatitude != null || rawMetadata?.GPSLatitude != null || rawMetadata?.latitude != null,
      gpsLongitudeFound: gpsLongitude != null || parsedLongitude != null || rawMetadata?.GPSLongitude != null || rawMetadata?.longitude != null,
      gpsResultValid: gpsLatitude != null && gpsLongitude != null,
    };

    if (capturedAt || capturedAtLocal || cameraInfo.camera || cameraInfo.cameraMake || cameraInfo.cameraModel || isValidLatitude(latitude) || isValidLongitude(longitude) || gpsAccuracyM != null || width != null || height != null) {
      return {
        hasExif: true,
        source: "exif",
        capturedAt,
        capturedAtLocal,
        timezoneOffset,
        camera: cameraInfo.camera,
        cameraMake: cameraInfo.cameraMake,
        cameraModel: cameraInfo.cameraModel,
        lensModel,
        orientation,
        focalLengthMm,
        apertureFNumber,
        exposureTimeSeconds,
        isoSpeed,
        software,
        latitude,
        longitude,
        gpsAccuracyM,
        width,
        height,
        locationSource,
        rawExif,
        diagnostics,
      };
    }

    return {
      hasExif: false,
      source: "none",
      warning: "No se encontraron metadatos EXIF útiles en esta imagen.",
      locationSource: "unknown",
      diagnostics,
    };
  } catch (error) {
    return {
      hasExif: false,
      source: "none",
      warning: error instanceof Error ? error.message : "No se pudo extraer EXIF desde el archivo.",
      locationSource: "unknown",
      diagnostics: {
        dateTimeOriginalFound: false,
        createDateFound: false,
        offsetTimeOriginalFound: false,
        gpsLatitudeFound: false,
        gpsLongitudeFound: false,
        gpsResultValid: false,
        parserError: error instanceof Error ? error.message : "Error desconocido del parser",
      },
    };
  }
}
