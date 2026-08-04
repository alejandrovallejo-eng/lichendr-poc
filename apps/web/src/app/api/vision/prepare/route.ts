import { NextRequest } from "next/server";

const VISION_SERVICE_URL = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8000";
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response(
      JSON.stringify({ error: "Expected multipart/form-data." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to parse form data." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const imageEntry = formData.get("image");
  if (!(imageEntry instanceof File)) {
    return new Response(
      JSON.stringify({ error: "Missing 'image' field." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const mime = imageEntry.type.split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_MIMES.has(mime)) {
    return new Response(
      JSON.stringify({ error: `Unsupported image type: ${mime}` }),
      { status: 415, headers: { "content-type": "application/json" } },
    );
  }

  if (imageEntry.size > MAX_BYTES) {
    return new Response(
      JSON.stringify({ error: "Image exceeds 20 MB limit." }),
      { status: 413, headers: { "content-type": "application/json" } },
    );
  }

  // Forward to vision service
  const upstream = new FormData();
  upstream.append("image", imageEntry);

  try {
    const response = await fetch(`${VISION_SERVICE_URL}/prepare`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(60_000),
    });

    const body = await response.json();
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Vision service unavailable." }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}
