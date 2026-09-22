from __future__ import annotations

import copy
import hashlib
import html
import json
import math
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path
from random import Random
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st
from PIL import ExifTags, Image, ImageDraw, ImageOps
from pillow_heif import register_heif_opener
from streamlit_image_coordinates import streamlit_image_coordinates


register_heif_opener()

st.set_page_config(
    page_title="LichenDR · Prototipo 0.2",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="expanded",
)

DATA_DIR = Path("data")
IMAGE_DIR = DATA_DIR / "images"
STATE_PATH = DATA_DIR / "lichendr_local.json"

STEPS = [
    "Inicio",
    "Sitio de muestreo",
    "Árbol o sustrato",
    "Imágenes",
    "Metadata y ubicación",
    "Anotación",
    "Resumen del árbol",
    "Resumen del sitio",
    "Exportar",
]

MORPHOTYPE_COLORS = [
    "#2E86AB",
    "#D95F59",
    "#6A994E",
    "#9B5DE5",
    "#E09F3E",
    "#008B8B",
    "#C44536",
    "#5E548E",
]

CLASS_COLORS = {
    "Liquen": "#4E8F56",
    "Corteza": "#9A6846",
    "Musgo": "#315E3B",
    "Alga": "#168C84",
    "Sombra": "#59636D",
    "Reflejo": "#F3C74E",
    "Desconocido": "#8A5CA8",
    "Fuera/no tronco": "#D5DBDB",
}

VALID_COVER_CLASSES = {"Liquen", "Corteza", "Musgo", "Alga"}
RADIUS_OPTIONS = [50, 100, 250, 500, 1000]


def now_iso() -> str:
    return datetime.now(ZoneInfo("America/Santo_Domingo")).isoformat(timespec="seconds")


def safe_slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-")
    return cleaned[:60] or "registro"


def option_index(options: list[str], value: Any, fallback: int = 0) -> int:
    return options.index(value) if value in options else fallback


def read_local_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {}
    try:
        payload = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def initialize_state() -> None:
    defaults = {
        "step": 0,
        "sites": read_local_state().get("sites", {}),
        "active_site_id": None,
        "active_tree_id": None,
        "active_image_id": None,
        "image_bytes": {},
        "event_versions": {},
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    if st.session_state.active_site_id not in st.session_state.sites:
        st.session_state.active_site_id = next(iter(st.session_state.sites), None)

    site = active_site()
    if site and st.session_state.active_tree_id not in site.get("trees", {}):
        st.session_state.active_tree_id = next(iter(site.get("trees", {})), None)

    tree = active_tree()
    image_ids = [image["id"] for image in tree.get("images", [])] if tree else []
    if st.session_state.active_image_id not in image_ids:
        st.session_state.active_image_id = image_ids[0] if image_ids else None


def active_site() -> dict[str, Any] | None:
    return st.session_state.sites.get(st.session_state.get("active_site_id"))


def active_tree() -> dict[str, Any] | None:
    site = active_site()
    if not site:
        return None
    return site.get("trees", {}).get(st.session_state.get("active_tree_id"))


def active_image() -> dict[str, Any] | None:
    tree = active_tree()
    if not tree:
        return None
    image_id = st.session_state.get("active_image_id")
    return next((item for item in tree.get("images", []) if item["id"] == image_id), None)


def go_to(step: int) -> None:
    st.session_state.step = max(0, min(step, len(STEPS) - 1))
    st.rerun()


def inject_css() -> None:
    st.markdown(
        """
        <style>
        :root {
            --lichen-navy: #15364a;
            --lichen-blue: #2e74b5;
            --lichen-green: #4e8f56;
        }
        .block-container {
            padding-top: 1.35rem;
            padding-bottom: 3rem;
            max-width: 1280px;
        }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #15364a 0%, #204e5e 100%);
        }
        [data-testid="stSidebar"] * { color: #ffffff; }
        [data-testid="stSidebar"] .stButton > button {
            border: 1px solid rgba(255,255,255,.20);
            background: rgba(255,255,255,.06);
            text-align: left;
        }
        [data-testid="stSidebar"] .stButton > button:hover {
            border-color: rgba(255,255,255,.65);
            background: rgba(255,255,255,.14);
        }
        .hero {
            padding: 2.1rem;
            border-radius: 22px;
            background:
                radial-gradient(circle at 85% 20%, rgba(255,255,255,.18), transparent 28%),
                linear-gradient(135deg, #15364a, #2e6b66);
            color: white;
            margin-bottom: 1.2rem;
        }
        .hero h1 { color: white; font-size: 2.7rem; margin: 0 0 .5rem 0; }
        .hero p {
            font-size: 1.06rem;
            max-width: 800px;
            margin: 0;
            color: rgba(255,255,255,.88);
        }
        .eyebrow {
            color: #cbdcae;
            font-size: .8rem;
            font-weight: 700;
            letter-spacing: .12em;
            text-transform: uppercase;
            margin-bottom: .65rem;
        }
        .soft-card {
            padding: 1rem 1.15rem;
            border: 1px solid #dfe7ea;
            border-radius: 16px;
            background: #ffffff;
            min-height: 112px;
        }
        .scientific-note {
            padding: 1rem 1.15rem;
            border-left: 5px solid #b7861e;
            background: #fff8e8;
            border-radius: 8px;
        }
        .success-note {
            padding: 1rem 1.15rem;
            border-left: 5px solid #4e8f56;
            background: #eef7ef;
            border-radius: 8px;
        }
        .context-chip {
            display: inline-block;
            padding: .25rem .65rem;
            margin: 0 .35rem .35rem 0;
            border-radius: 999px;
            background: #e8eef5;
            color: #15364a;
            font-size: .82rem;
            font-weight: 600;
        }
        .step-caption {
            color: #65727a;
            font-size: .93rem;
            margin-bottom: 1.1rem;
        }
        .legend-row {
            display: flex;
            flex-wrap: wrap;
            gap: .45rem;
            margin: .55rem 0 1rem 0;
        }
        .legend-chip {
            display: inline-flex;
            align-items: center;
            gap: .38rem;
            padding: .28rem .58rem;
            border-radius: 999px;
            border: 1px solid #dde4e7;
            font-size: .82rem;
            background: white;
        }
        .legend-dot {
            width: .72rem;
            height: .72rem;
            border-radius: 50%;
            display: inline-block;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def context_html() -> str:
    site = active_site()
    tree = active_tree()
    image = active_image()
    values = []
    if site:
        values.append(f"Sitio: {html.escape(str(site['name']))}")
    if tree:
        values.append(f"Árbol: {html.escape(str(tree['code']))}")
    if image:
        values.append(f"Imagen: {html.escape(str(image['name']))}")
    if not values:
        return ""
    return "".join(f'<span class="context-chip">{value}</span>' for value in values)


def page_heading(title: str, description: str) -> None:
    st.title(title)
    st.markdown(f'<div class="step-caption">{description}</div>', unsafe_allow_html=True)
    context = context_html()
    if context:
        st.markdown(context, unsafe_allow_html=True)
        st.markdown("")


def sidebar() -> None:
    with st.sidebar:
        st.markdown("## 🌿 LichenDR")
        st.caption("Prototipo 0.2 · República Dominicana")

        site_ids = list(st.session_state.sites)
        if site_ids:
            site_labels = {
                site_id: st.session_state.sites[site_id]["name"] for site_id in site_ids
            }
            current_site = st.session_state.active_site_id
            selected_site = st.selectbox(
                "Sitio activo",
                site_ids,
                index=site_ids.index(current_site) if current_site in site_ids else 0,
                format_func=lambda value: site_labels[value],
                key="sidebar_site",
            )
            if selected_site != current_site:
                st.session_state.active_site_id = selected_site
                st.session_state.active_tree_id = None
                st.session_state.active_image_id = None
                st.rerun()

        site = active_site()
        tree_ids = list(site.get("trees", {})) if site else []
        if tree_ids:
            tree_labels = {tree_id: site["trees"][tree_id]["code"] for tree_id in tree_ids}
            current_tree = st.session_state.active_tree_id
            selected_tree = st.selectbox(
                "Árbol activo",
                tree_ids,
                index=tree_ids.index(current_tree) if current_tree in tree_ids else 0,
                format_func=lambda value: tree_labels[value],
                key="sidebar_tree",
            )
            if selected_tree != current_tree:
                st.session_state.active_tree_id = selected_tree
                st.session_state.active_image_id = None
                st.rerun()

        tree = active_tree()
        image_ids = [image["id"] for image in tree.get("images", [])] if tree else []
        if image_ids:
            image_labels = {image["id"]: image["name"] for image in tree["images"]}
            current_image = st.session_state.active_image_id
            selected_image = st.selectbox(
                "Imagen activa",
                image_ids,
                index=image_ids.index(current_image) if current_image in image_ids else 0,
                format_func=lambda value: image_labels[value],
                key="sidebar_image",
            )
            if selected_image != current_image:
                st.session_state.active_image_id = selected_image
                st.rerun()

        st.markdown("---")
        st.progress((st.session_state.step + 1) / len(STEPS))
        st.caption(f"Paso {st.session_state.step + 1} de {len(STEPS)}")
        for index, label in enumerate(STEPS):
            prefix = "●" if index == st.session_state.step else "○"
            if st.button(
                f"{prefix}  {label}",
                key=f"sidebar_step_{index}",
                width="stretch",
            ):
                go_to(index)
        st.markdown("---")
        st.caption("Datos guardados localmente durante el prototipo")


def navigation() -> None:
    st.markdown("---")
    left, _, right = st.columns([1, 4, 1])
    if st.session_state.step > 0:
        if left.button(
            "← Atrás",
            key=f"back_{st.session_state.step}",
            width="stretch",
        ):
            go_to(st.session_state.step - 1)
    if st.session_state.step < len(STEPS) - 1:
        if right.button(
            "Continuar →",
            key=f"next_{st.session_state.step}",
            type="primary",
            width="stretch",
        ):
            go_to(st.session_state.step + 1)


def gate(message: str, destination: int, button_label: str) -> bool:
    st.warning(message)
    if st.button(button_label, type="primary"):
        go_to(destination)
    return False


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        try:
            return float(value.numerator) / float(value.denominator)
        except Exception:
            return None


def gps_coordinate(values: Any, reference: Any) -> float | None:
    if not values or len(values) < 3:
        return None
    degrees, minutes, seconds = (to_float(item) for item in values[:3])
    if None in (degrees, minutes, seconds):
        return None
    result = float(degrees) + float(minutes) / 60 + float(seconds) / 3600
    if isinstance(reference, bytes):
        reference = reference.decode(errors="ignore")
    if str(reference).upper() in {"S", "W"}:
        result = -result
    return result


def exif_value(exif: Any, exif_ifd: dict[int, Any], tag: int) -> Any:
    return exif_ifd.get(tag, exif.get(tag))


def extract_metadata(raw: bytes, filename: str, mime_type: str) -> tuple[dict[str, Any], Image.Image]:
    metadata: dict[str, Any] = {
        "filename": filename,
        "mime_type": mime_type or "unknown",
        "file_size_bytes": len(raw),
        "upload_date": now_iso(),
        "capture_date": None,
        "capture_date_tag": None,
        "camera_make": None,
        "camera_model": None,
        "software": None,
        "orientation": None,
        "gps_latitude": None,
        "gps_longitude": None,
        "gps_altitude_m": None,
        "gps_accuracy_m": None,
        "exif_present": False,
        "gps_present": False,
        "warnings": [],
    }
    try:
        image = Image.open(BytesIO(raw))
        image.load()
    except Exception as exc:
        raise ValueError(f"No se pudo leer {filename}: {exc}") from exc

    metadata["format"] = image.format
    metadata["width_px"], metadata["height_px"] = image.size

    try:
        exif = image.getexif()
    except Exception:
        exif = {}

    if exif:
        metadata["exif_present"] = True
        try:
            exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
        except Exception:
            exif_ifd = {}

        date_candidates = [
            (36867, "DateTimeOriginal"),
            (36868, "DateTimeDigitized"),
            (306, "DateTime"),
        ]
        for tag, name in date_candidates:
            value = exif_value(exif, exif_ifd, tag)
            if value:
                if isinstance(value, bytes):
                    value = value.decode(errors="ignore")
                metadata["capture_date"] = str(value)
                metadata["capture_date_tag"] = name
                break

        metadata["camera_make"] = exif.get(271)
        metadata["camera_model"] = exif.get(272)
        metadata["software"] = exif.get(305)
        metadata["orientation"] = exif.get(274)

        try:
            gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
        except Exception:
            try:
                gps_ifd = exif.get_ifd(34853)
            except Exception:
                gps_ifd = {}

        if gps_ifd:
            latitude = gps_coordinate(gps_ifd.get(2), gps_ifd.get(1))
            longitude = gps_coordinate(gps_ifd.get(4), gps_ifd.get(3))
            if latitude is not None and longitude is not None:
                metadata["gps_latitude"] = latitude
                metadata["gps_longitude"] = longitude
                metadata["gps_present"] = True
            altitude = to_float(gps_ifd.get(6))
            if altitude is not None and gps_ifd.get(5) == 1:
                altitude = -altitude
            metadata["gps_altitude_m"] = altitude
            metadata["gps_accuracy_m"] = to_float(gps_ifd.get(31))

    if not metadata["capture_date"]:
        metadata["warnings"].append(
            "No se encontró fecha de captura EXIF; se conserva la fecha de carga por separado."
        )
    if not metadata["gps_present"]:
        metadata["warnings"].append(
            "No se encontró GPS EXIF. Puede confirmar la ubicación del árbol o introducirla manualmente."
        )

    oriented = ImageOps.exif_transpose(image).convert("RGB")
    return metadata, oriented


def get_image_bytes(image_record: dict[str, Any]) -> bytes | None:
    image_id = image_record["id"]
    if image_id in st.session_state.image_bytes:
        return st.session_state.image_bytes[image_id]
    saved_path = image_record.get("saved_path")
    if saved_path and Path(saved_path).exists():
        return Path(saved_path).read_bytes()
    return None


def get_pil_image(image_record: dict[str, Any]) -> Image.Image | None:
    raw = get_image_bytes(image_record)
    if raw is None:
        return None
    try:
        _, image = extract_metadata(
            raw,
            image_record.get("name", "image"),
            image_record.get("mime_type", "unknown"),
        )
        return image
    except Exception:
        return None


def event_token(value: dict[str, Any]) -> str:
    if "unix_time" in value:
        return str(value["unix_time"])
    return json.dumps(value, sort_keys=True, default=str)


def is_new_event(key: str, value: dict[str, Any]) -> bool:
    token = event_token(value)
    old = st.session_state.event_versions.get(key)
    if token == old:
        return False
    st.session_state.event_versions[key] = token
    return True


def normalized_point(value: dict[str, Any]) -> tuple[float, float] | None:
    width = to_float(value.get("width"))
    height = to_float(value.get("height"))
    x = to_float(value.get("x"))
    y = to_float(value.get("y"))
    if not width or not height or x is None or y is None:
        return None
    return max(0.0, min(1.0, x / width)), max(0.0, min(1.0, y / height))


def normalized_roi(value: dict[str, Any]) -> list[float] | None:
    width = to_float(value.get("width"))
    height = to_float(value.get("height"))
    coords = [to_float(value.get(key)) for key in ("x1", "y1", "x2", "y2")]
    if not width or not height or any(item is None for item in coords):
        return None
    x1, y1, x2, y2 = coords
    left, right = sorted((x1 / width, x2 / width))
    top, bottom = sorted((y1 / height, y2 / height))
    if right - left < 0.05 or bottom - top < 0.05:
        return None
    return [
        max(0.0, left),
        max(0.0, top),
        min(1.0, right),
        min(1.0, bottom),
    ]


def generate_grid(image_record: dict[str, Any]) -> list[dict[str, Any]]:
    roi = image_record.get("roi") or [0.05, 0.05, 0.95, 0.95]
    left, top, right, bottom = roi
    seed = int(image_record["id"][:8], 16)
    rng = Random(seed)
    points = []
    for index in range(50):
        row, col = divmod(index, 10)
        cell_width = (right - left) / 10
        cell_height = (bottom - top) / 5
        x = left + (col + rng.uniform(0.25, 0.75)) * cell_width
        y = top + (row + rng.uniform(0.25, 0.75)) * cell_height
        points.append(
            {
                "index": index,
                "x": x,
                "y": y,
                "class": None,
                "morphotype_code": None,
            }
        )
    return points


def draw_overlay(
    image: Image.Image,
    image_record: dict[str, Any],
    tree: dict[str, Any],
    layer: str,
) -> Image.Image:
    canvas = image.copy()
    canvas.thumbnail((1200, 900))
    draw = ImageDraw.Draw(canvas, "RGBA")
    width, height = canvas.size

    roi = image_record.get("roi")
    if roi:
        left, top, right, bottom = roi
        draw.rectangle(
            (left * width, top * height, right * width, bottom * height),
            outline="#FFFFFF",
            width=max(3, width // 260),
        )

    if layer == "coverage":
        for point in image_record.get("grid", []):
            x, y = point["x"] * width, point["y"] * height
            label = point.get("class")
            color = CLASS_COLORS.get(label, "#FFFFFF")
            radius = max(7, width // 105)
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=color + ("E8" if label else "90"),
                outline="#15364A" if not label else "#FFFFFF",
                width=max(2, radius // 4),
            )
    elif layer == "morphotypes":
        morphotypes = tree.get("morphotypes", {})
        for annotation in image_record.get("morphotype_points", []):
            morphotype = morphotypes.get(annotation["morphotype_code"], {})
            color = morphotype.get("color", "#2E86AB")
            x, y = annotation["x"] * width, annotation["y"] * height
            radius = max(9, width // 90)
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=color + "E8",
                outline="#FFFFFF",
                width=max(2, radius // 4),
            )
            draw.text(
                (x + radius + 2, y - radius),
                annotation["morphotype_code"],
                fill="#FFFFFF",
                stroke_width=2,
                stroke_fill="#15364A",
            )
    return canvas


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def image_analysis_metrics(image_record: dict[str, Any]) -> dict[str, Any]:
    grid = image_record.get("grid", [])
    labeled = [point for point in grid if point.get("class")]
    valid = [point for point in labeled if point["class"] in VALID_COVER_CLASSES]
    lichen = [point for point in valid if point["class"] == "Liquen"]
    cover = 100 * len(lichen) / len(valid) if valid else None
    assessable = 100 * len(valid) / 50 if grid else None
    return {
        "labeled_points": len(labeled),
        "valid_points": len(valid),
        "lichen_points": len(lichen),
        "cover_pct": cover,
        "assessable_pct": assessable,
        "complete": len(labeled) == 50,
        "valid_image": len(labeled) == 50 and assessable is not None and assessable >= 80,
    }


def persist_project() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for site in st.session_state.sites.values():
        for tree in site.get("trees", {}).values():
            for image in tree.get("images", []):
                raw = st.session_state.image_bytes.get(image["id"])
                if raw is not None and not image.get("saved_path"):
                    suffix = Path(image["name"]).suffix.lower() or ".jpg"
                    destination = IMAGE_DIR / f"{image['id']}{suffix}"
                    destination.write_bytes(raw)
                    image["saved_path"] = str(destination)
                image["updated_at"] = now_iso()
    serializable = {"version": "0.2", "saved_at": now_iso(), "sites": st.session_state.sites}
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(serializable, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    temporary.replace(STATE_PATH)


def morphotype_legend(tree: dict[str, Any]) -> str:
    chips = []
    for code, morphotype in tree.get("morphotypes", {}).items():
        chips.append(
            f'<span class="legend-chip"><span class="legend-dot" '
            f'style="background:{morphotype["color"]}"></span>'
            f'{html.escape(str(code))} · {html.escape(str(morphotype["label"]))}</span>'
        )
    return '<div class="legend-row">' + "".join(chips) + "</div>"


def class_legend() -> str:
    chips = []
    for label, color in CLASS_COLORS.items():
        chips.append(
            f'<span class="legend-chip"><span class="legend-dot" '
            f'style="background:{color}"></span>{label}</span>'
        )
    return '<div class="legend-row">' + "".join(chips) + "</div>"


def image_rows(site: dict[str, Any] | None = None) -> pd.DataFrame:
    rows = []
    sites = [site] if site else list(st.session_state.sites.values())
    for item_site in sites:
        if not item_site:
            continue
        for tree in item_site.get("trees", {}).values():
            for image in tree.get("images", []):
                metrics = image_analysis_metrics(image)
                visible_codes = sorted(
                    {
                        point["morphotype_code"]
                        for point in image.get("morphotype_points", [])
                    }
                )
                rows.append(
                    {
                        "site_id": item_site["id"],
                        "site_name": item_site["name"],
                        "radius_m": item_site["radius_m"],
                        "tree_id": tree["id"],
                        "tree_code": tree["code"],
                        "image_id": image["id"],
                        "file_name": image["name"],
                        "upload_date": image["metadata"].get("upload_date"),
                        "capture_date_exif": image["metadata"].get("capture_date"),
                        "capture_date_tag": image["metadata"].get("capture_date_tag"),
                        "capture_date_confirmed": image.get("confirmed_capture_date"),
                        "exif_latitude": image["metadata"].get("gps_latitude"),
                        "exif_longitude": image["metadata"].get("gps_longitude"),
                        "exif_gps_accuracy_m": image["metadata"].get("gps_accuracy_m"),
                        "confirmed_latitude": image.get("confirmed_latitude"),
                        "confirmed_longitude": image.get("confirmed_longitude"),
                        "location_source": image.get("location_source"),
                        "trunk_orientation": image.get("orientation"),
                        "camera_make": image["metadata"].get("camera_make"),
                        "camera_model": image["metadata"].get("camera_model"),
                        "cover_pct": metrics["cover_pct"],
                        "assessable_pct": metrics["assessable_pct"],
                        "grid_labeled": metrics["labeled_points"],
                        "visible_morphotype_points": len(image.get("morphotype_points", [])),
                        "visible_morphotype_richness": len(visible_codes),
                        "visible_morphotype_codes": ";".join(visible_codes),
                        "analysis_complete": metrics["complete"],
                        "saved_at": image.get("updated_at"),
                    }
                )
    return pd.DataFrame(rows)


def tree_rows(site: dict[str, Any] | None = None) -> pd.DataFrame:
    rows = []
    sites = [site] if site else list(st.session_state.sites.values())
    for item_site in sites:
        if not item_site:
            continue
        for tree in item_site.get("trees", {}).values():
            covers = []
            valid_images = 0
            observed_codes = set()
            for image in tree.get("images", []):
                metrics = image_analysis_metrics(image)
                if metrics["valid_image"]:
                    valid_images += 1
                    covers.append(metrics["cover_pct"])
                observed_codes.update(
                    point["morphotype_code"]
                    for point in image.get("morphotype_points", [])
                )
            distance = None
            if tree.get("latitude") is not None and tree.get("longitude") is not None:
                distance = haversine_m(
                    item_site["center_latitude"],
                    item_site["center_longitude"],
                    tree["latitude"],
                    tree["longitude"],
                )
            rows.append(
                {
                    "site_id": item_site["id"],
                    "site_name": item_site["name"],
                    "tree_id": tree["id"],
                    "tree_code": tree["code"],
                    "tree_species": tree.get("tree_species"),
                    "substrate_type": tree.get("substrate_type"),
                    "sampling_height_cm": tree.get("sampling_height_cm"),
                    "shade_level": tree.get("shade_level"),
                    "nearby_road": tree.get("nearby_road"),
                    "pollution_source": tree.get("pollution_source"),
                    "latitude": tree.get("latitude"),
                    "longitude": tree.get("longitude"),
                    "distance_to_site_center_m": distance,
                    "inside_radius": distance <= item_site["radius_m"] if distance is not None else None,
                    "number_of_images": len(tree.get("images", [])),
                    "valid_images": valid_images,
                    "mean_cover_pct": sum(covers) / len(covers) if covers else None,
                    "visible_morphotypes_on_tree": len(observed_codes),
                }
            )
    return pd.DataFrame(rows)


def annotation_rows(site: dict[str, Any] | None = None) -> pd.DataFrame:
    rows = []
    sites = [site] if site else list(st.session_state.sites.values())
    for item_site in sites:
        if not item_site:
            continue
        for tree in item_site.get("trees", {}).values():
            morphotypes = tree.get("morphotypes", {})
            for image in tree.get("images", []):
                for point in image.get("grid", []):
                    code = point.get("morphotype_code")
                    morphotype = morphotypes.get(code, {})
                    rows.append(
                        {
                            "site_id": item_site["id"],
                            "site_name": item_site["name"],
                            "tree_id": tree["id"],
                            "tree_code": tree["code"],
                            "image_id": image["id"],
                            "file_name": image["name"],
                            "annotation_layer": "fixed_cover_grid",
                            "point_index": point["index"],
                            "x_normalized": point["x"],
                            "y_normalized": point["y"],
                            "class": point.get("class"),
                            "morphotype_code": code,
                            "morphotype_label": morphotype.get("label"),
                            "growth_form": morphotype.get("growth_form"),
                        }
                    )
                for index, point in enumerate(image.get("morphotype_points", []), 1):
                    code = point.get("morphotype_code")
                    morphotype = morphotypes.get(code, {})
                    rows.append(
                        {
                            "site_id": item_site["id"],
                            "site_name": item_site["name"],
                            "tree_id": tree["id"],
                            "tree_code": tree["code"],
                            "image_id": image["id"],
                            "file_name": image["name"],
                            "annotation_layer": "free_morphotype_evidence",
                            "point_index": index,
                            "x_normalized": point["x"],
                            "y_normalized": point["y"],
                            "class": "Liquen",
                            "morphotype_code": code,
                            "morphotype_label": morphotype.get("label"),
                            "growth_form": morphotype.get("growth_form"),
                        }
                    )
    return pd.DataFrame(rows)


def export_project_json() -> bytes:
    sites = copy.deepcopy(st.session_state.sites)
    for site in sites.values():
        for tree in site.get("trees", {}).values():
            for image in tree.get("images", []):
                image.pop("saved_path", None)
    payload = {
        "version": "0.2",
        "exported_at": now_iso(),
        "sites": sites,
    }
    return json.dumps(
        payload, ensure_ascii=False, indent=2, default=str
    ).encode("utf-8")


def home_page() -> None:
    st.markdown(
        """
        <div class="hero">
            <div class="eyebrow">Sitios → árboles → imágenes → evidencia</div>
            <h1>LichenDR</h1>
            <p>
                Organiza un sitio de muestreo, registra varios árboles dentro de un
                radio y analiza varias imágenes por árbol para documentar cobertura
                y morfotipos visibles.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown(
            '<div class="soft-card"><b>Sitio de muestreo</b><br><br>'
            "Nombre libre, centro geográfico y radio seleccionable.</div>",
            unsafe_allow_html=True,
        )
    with col2:
        st.markdown(
            '<div class="soft-card"><b>Árboles independientes</b><br><br>'
            "Cada árbol conserva sus propias imágenes y morfotipos.</div>",
            unsafe_allow_html=True,
        )
    with col3:
        st.markdown(
            '<div class="soft-card"><b>Dos capas de anotación</b><br><br>'
            "Cobertura por puntos aleatorios y diversidad visual por morfotipos.</div>",
            unsafe_allow_html=True,
        )
    st.markdown("")
    st.markdown(
        """
        <div class="scientific-note">
            <b>Importante:</b> los puntos que el usuario coloca libremente sirven
            para registrar morfotipos. La cobertura se calcula con una cuadrícula
            fija de 50 puntos para evitar elegir únicamente las áreas con liquen.
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown("")
    if st.button("Crear o continuar un sitio", type="primary"):
        go_to(1)


def site_page() -> None:
    page_heading(
        "Sitio de muestreo",
        "El sitio agrupa los árboles que se analizarán dentro de un centro y radio definidos por el usuario.",
    )
    site = active_site()
    existing = bool(site)
    mode_key = f"new_site_mode_{site['id'] if site else 'none'}"
    new_mode = st.toggle("Crear un sitio nuevo", value=not existing, key=mode_key)
    base = {} if new_mode or not site else site

    form_scope = "new" if new_mode else base.get("id", "site")
    with st.form(f"site_form_{form_scope}"):
        left, right = st.columns(2)
        with left:
            name = st.text_input(
                "Nombre del sitio *",
                value=base.get("name", ""),
                placeholder="Ej. Parque Mirador Sur · Sector norte",
            )
            province = st.text_input(
                "Provincia",
                value=base.get("province", "Distrito Nacional"),
            )
            municipality = st.text_input(
                "Municipio",
                value=base.get("municipality", "Santo Domingo de Guzmán"),
            )
            radius_m = st.selectbox(
                "Radio de análisis",
                RADIUS_OPTIONS,
                index=RADIUS_OPTIONS.index(base.get("radius_m", 100))
                if base.get("radius_m", 100) in RADIUS_OPTIONS
                else 1,
                format_func=lambda value: f"{value} m" if value < 1000 else "1 km",
            )
        with right:
            center_latitude = st.number_input(
                "Latitud del centro *",
                min_value=-90.0,
                max_value=90.0,
                value=float(base.get("center_latitude", 18.4861)),
                format="%.6f",
            )
            center_longitude = st.number_input(
                "Longitud del centro *",
                min_value=-180.0,
                max_value=180.0,
                value=float(base.get("center_longitude", -69.9312)),
                format="%.6f",
            )
            notes = st.text_area(
                "Descripción o notas del sitio",
                value=base.get("notes", ""),
            )
            st.map(
                pd.DataFrame({"lat": [center_latitude], "lon": [center_longitude]}),
                zoom=13,
                height=260,
            )
        submitted = st.form_submit_button(
            "Crear sitio" if new_mode else "Guardar cambios del sitio",
            type="primary",
        )
        if submitted:
            if not name.strip():
                st.error("El sitio necesita un nombre.")
            else:
                if new_mode or not site:
                    site_id = f"S-{uuid4().hex[:8]}"
                    site = {
                        "id": site_id,
                        "created_at": now_iso(),
                        "trees": {},
                    }
                    st.session_state.sites[site_id] = site
                site.update(
                    {
                        "name": name.strip(),
                        "province": province.strip(),
                        "municipality": municipality.strip(),
                        "radius_m": radius_m,
                        "center_latitude": center_latitude,
                        "center_longitude": center_longitude,
                        "notes": notes,
                        "updated_at": now_iso(),
                    }
                )
                st.session_state.active_site_id = site["id"]
                st.session_state.active_tree_id = None
                st.session_state.active_image_id = None
                persist_project()
                st.success(f"Sitio “{site['name']}” guardado.")

    if active_site():
        st.markdown("")
        if st.button("Añadir el primer árbol →", type="primary"):
            go_to(2)


def tree_page() -> None:
    page_heading(
        "Árbol o sustrato",
        "Cada árbol es una unidad independiente. Varias fotografías pueden pertenecer al mismo árbol.",
    )
    site = active_site()
    if not site:
        gate("Primero crea o selecciona un sitio.", 1, "Ir a Sitio de muestreo")
        return

    tree = active_tree()
    existing = bool(tree)
    mode_key = f"new_tree_mode_{tree['id'] if tree else 'none'}"
    new_mode = st.toggle("Crear un árbol nuevo", value=not existing, key=mode_key)
    base = {} if new_mode or not tree else tree

    form_scope = "new" if new_mode else base.get("id", "tree")
    with st.form(f"tree_form_{form_scope}"):
        left, right = st.columns(2)
        with left:
            code = st.text_input(
                "Código o nombre del árbol *",
                value=base.get("code", ""),
                placeholder="Ej. T-001, Caoba-1",
            )
            tree_species = st.text_input(
                "Especie del árbol, si se conoce",
                value=base.get("tree_species", ""),
            )
            substrate_options = [
                "Corteza de árbol",
                "Madera muerta",
                "Roca",
                "Artificial",
                "Otro",
            ]
            substrate_type = st.selectbox(
                "Sustrato *",
                substrate_options,
                index=option_index(
                    substrate_options, base.get("substrate_type"), 0
                ),
            )
            orientation_options = [
                "N",
                "NE",
                "E",
                "SE",
                "S",
                "SW",
                "W",
                "NW",
                "Desconocida",
            ]
            orientation = st.selectbox(
                "Orientación predeterminada para las fotos",
                orientation_options,
                index=option_index(
                    orientation_options, base.get("orientation"), 8
                ),
            )
        with right:
            sampling_height_cm = st.number_input(
                "Altura aproximada de muestreo (cm)",
                min_value=0,
                max_value=500,
                value=int(base.get("sampling_height_cm", 150)),
            )
            shade_options = [
                "Sol abierto",
                "Sombra parcial",
                "Sombra profunda",
                "Desconocida",
            ]
            shade_level = st.selectbox(
                "Sombra",
                shade_options,
                index=option_index(shade_options, base.get("shade_level"), 1),
            )
            nearby_road = st.checkbox(
                "Carretera cercana",
                value=bool(base.get("nearby_road", False)),
            )
            pollution_source = st.checkbox(
                "Fuente potencial de contaminación cercana",
                value=bool(base.get("pollution_source", False)),
            )
            notes = st.text_area("Notas del árbol", value=base.get("notes", ""))
        submitted = st.form_submit_button(
            "Crear árbol" if new_mode else "Guardar cambios del árbol",
            type="primary",
        )
        if submitted:
            if not code.strip():
                st.error("El árbol necesita un código o nombre.")
            elif new_mode and any(
                item["code"].lower() == code.strip().lower()
                for item in site["trees"].values()
            ):
                st.error("Ya existe un árbol con ese código dentro del sitio.")
            else:
                if new_mode or not tree:
                    tree_id = f"T-{uuid4().hex[:8]}"
                    tree = {
                        "id": tree_id,
                        "created_at": now_iso(),
                        "images": [],
                        "morphotypes": {},
                        "latitude": None,
                        "longitude": None,
                        "location_source": None,
                    }
                    site["trees"][tree_id] = tree
                tree.update(
                    {
                        "code": code.strip(),
                        "tree_species": tree_species.strip(),
                        "substrate_type": substrate_type,
                        "orientation": orientation,
                        "sampling_height_cm": sampling_height_cm,
                        "shade_level": shade_level,
                        "nearby_road": nearby_road,
                        "pollution_source": pollution_source,
                        "notes": notes,
                        "updated_at": now_iso(),
                    }
                )
                st.session_state.active_tree_id = tree["id"]
                st.session_state.active_image_id = None
                persist_project()
                st.success(f"Árbol “{tree['code']}” guardado dentro de {site['name']}.")

    if active_tree():
        st.markdown("")
        if st.button("Añadir imágenes a este árbol →", type="primary"):
            go_to(3)


def images_page() -> None:
    page_heading(
        "Imágenes del árbol",
        "Carga una o varias fotografías. Cada archivo conservará su metadata y análisis independiente.",
    )
    tree = active_tree()
    if not tree:
        gate("Primero crea o selecciona un árbol.", 2, "Ir a Árbol o sustrato")
        return

    files = st.file_uploader(
        "Selecciona fotografías del árbol activo",
        type=["jpg", "jpeg", "png", "heic", "heif"],
        accept_multiple_files=True,
        help="JPG, PNG y fotografías HEIC/HEIF de iPhone.",
        key=f"image_uploader_{tree['id']}",
    )
    if files:
        added, skipped, errors = 0, 0, []
        known_ids = {item["id"] for item in tree["images"]}
        for file in files:
            raw = file.getvalue()
            image_id = hashlib.sha256(raw).hexdigest()[:16]
            if image_id in known_ids:
                skipped += 1
                continue
            try:
                metadata, _ = extract_metadata(raw, file.name, file.type)
            except ValueError as exc:
                errors.append(str(exc))
                continue
            image = {
                "id": image_id,
                "name": file.name,
                "mime_type": file.type,
                "metadata": metadata,
                "confirmed_capture_date": metadata.get("capture_date"),
                "confirmed_latitude": metadata.get("gps_latitude"),
                "confirmed_longitude": metadata.get("gps_longitude"),
                "location_source": "EXIF" if metadata.get("gps_present") else None,
                "orientation": tree.get("orientation"),
                "roi": [0.05, 0.05, 0.95, 0.95],
                "grid": [],
                "morphotype_points": [],
                "created_at": now_iso(),
            }
            image["grid"] = generate_grid(image)
            tree["images"].append(image)
            st.session_state.image_bytes[image_id] = raw
            known_ids.add(image_id)
            added += 1
        if tree["images"] and not st.session_state.active_image_id:
            st.session_state.active_image_id = tree["images"][0]["id"]
        if added:
            persist_project()
            st.success(f"{added} imagen(es) añadida(s) al árbol {tree['code']}.")
        if skipped:
            st.info(f"{skipped} archivo(s) duplicado(s) no se añadieron otra vez.")
        for message in errors:
            st.error(message)

    if not tree["images"]:
        st.info("Este árbol todavía no contiene imágenes.")
        return

    columns = st.columns(min(3, len(tree["images"])))
    for index, image_record in enumerate(tree["images"]):
        with columns[index % len(columns)]:
            image = get_pil_image(image_record)
            if image:
                st.image(image, caption=image_record["name"], width="stretch")
            metadata = image_record["metadata"]
            date_text = metadata.get("capture_date") or "Sin fecha EXIF"
            gps_text = (
                f"{metadata['gps_latitude']:.5f}, {metadata['gps_longitude']:.5f}"
                if metadata.get("gps_present")
                else "Sin GPS EXIF"
            )
            st.caption(f"{date_text} · {gps_text}")
            if st.button(
                "Seleccionar",
                key=f"select_image_{image_record['id']}",
                type="primary"
                if image_record["id"] == st.session_state.active_image_id
                else "secondary",
            ):
                st.session_state.active_image_id = image_record["id"]
                st.rerun()

    st.markdown("")
    save_col, metadata_col = st.columns(2)
    if save_col.button("Guardar imágenes", type="primary", width="stretch"):
        persist_project()
        st.success("Imágenes guardadas en el almacenamiento local del prototipo.")
    if metadata_col.button("Revisar metadata →", width="stretch"):
        go_to(4)


def metadata_page() -> None:
    page_heading(
        "Metadata y ubicación",
        "Se extraen automáticamente la fecha de captura y el GPS EXIF cuando el archivo los conserva.",
    )
    image_record = active_image()
    tree = active_tree()
    site = active_site()
    if not image_record or not tree or not site:
        gate("Selecciona primero una imagen.", 3, "Ir a Imágenes")
        return

    metadata = image_record["metadata"]
    left, right = st.columns([1, 1.25])
    with left:
        st.markdown("#### Metadata extraída")
        rows = [
            ["Archivo", metadata.get("filename")],
            ["Formato", metadata.get("format")],
            ["Dimensiones", f"{metadata.get('width_px')} × {metadata.get('height_px')} px"],
            ["Fecha de captura", metadata.get("capture_date") or "No disponible"],
            ["Tag de fecha", metadata.get("capture_date_tag") or "—"],
            ["Cámara", " ".join(filter(None, [str(metadata.get("camera_make") or ""), str(metadata.get("camera_model") or "")])) or "No disponible"],
            ["GPS EXIF", "Disponible" if metadata.get("gps_present") else "No disponible"],
            [
                "Precisión GPS",
                str(metadata.get("gps_accuracy_m"))
                if metadata.get("gps_accuracy_m") is not None
                else "No informada",
            ],
        ]
        st.dataframe(
            pd.DataFrame(rows, columns=["Campo", "Valor"]),
            width="stretch",
            hide_index=True,
        )
        for warning in metadata.get("warnings", []):
            st.warning(warning)
    with right:
        image = get_pil_image(image_record)
        if image:
            st.image(image, caption=image_record["name"], width="stretch")

    st.markdown("#### Confirmación")
    capture_date = st.text_input(
        "Fecha y hora confirmadas",
        value=image_record.get("confirmed_capture_date")
        or metadata.get("capture_date")
        or "",
        placeholder="YYYY:MM:DD HH:MM:SS",
        key=f"capture_date_{image_record['id']}",
    )
    orientation_options = [
        "N",
        "NE",
        "E",
        "SE",
        "S",
        "SW",
        "W",
        "NW",
        "Desconocida",
    ]
    image_orientation = st.selectbox(
        "Orientación o cara del tronco mostrada en esta imagen",
        orientation_options,
        index=option_index(
            orientation_options,
            image_record.get("orientation") or tree.get("orientation"),
            8,
        ),
        key=f"image_orientation_{image_record['id']}",
    )

    exif_available = metadata.get("gps_present", False)
    location_choices = []
    if exif_available:
        location_choices.append("Usar GPS EXIF")
    if tree.get("latitude") is not None:
        location_choices.append("Usar ubicación confirmada del árbol")
    location_choices.extend(["Introducir coordenadas manualmente", "Usar centro del sitio"])

    default_choice = (
        "Usar GPS EXIF"
        if exif_available
        else (
            "Usar ubicación confirmada del árbol"
            if tree.get("latitude") is not None
            else "Usar centro del sitio"
        )
    )
    choice = st.radio(
        "Fuente para la ubicación confirmada",
        location_choices,
        index=location_choices.index(default_choice),
        key=f"location_choice_{image_record['id']}",
    )

    if choice == "Usar GPS EXIF":
        default_lat = metadata["gps_latitude"]
        default_lon = metadata["gps_longitude"]
        source = "EXIF"
    elif choice == "Usar ubicación confirmada del árbol":
        default_lat = tree["latitude"]
        default_lon = tree["longitude"]
        source = "Árbol confirmado"
    elif choice == "Usar centro del sitio":
        default_lat = site["center_latitude"]
        default_lon = site["center_longitude"]
        source = "Centro del sitio"
    else:
        default_lat = image_record.get("confirmed_latitude")
        default_lon = image_record.get("confirmed_longitude")
        default_lat = default_lat if default_lat is not None else site["center_latitude"]
        default_lon = default_lon if default_lon is not None else site["center_longitude"]
        source = "Manual"

    lat_col, lon_col = st.columns(2)
    latitude = lat_col.number_input(
        "Latitud confirmada",
        min_value=-90.0,
        max_value=90.0,
        value=float(default_lat),
        format="%.7f",
        key=f"confirmed_latitude_{image_record['id']}_{source}",
    )
    longitude = lon_col.number_input(
        "Longitud confirmada",
        min_value=-180.0,
        max_value=180.0,
        value=float(default_lon),
        format="%.7f",
        key=f"confirmed_longitude_{image_record['id']}_{source}",
    )
    st.map(pd.DataFrame({"lat": [latitude], "lon": [longitude]}), zoom=14, height=330)

    update_tree = st.checkbox(
        "Usar esta ubicación como ubicación confirmada del árbol",
        value=tree.get("latitude") is None,
        key=f"update_tree_location_{image_record['id']}",
    )
    if tree.get("latitude") is not None:
        difference = haversine_m(
            tree["latitude"], tree["longitude"], latitude, longitude
        )
        if difference > 50:
            st.warning(
                f"Esta imagen está a {difference:.0f} m de la ubicación actual del árbol. "
                "Confirma que pertenece al mismo árbol."
            )

    if st.button("Guardar metadata y ubicación", type="primary"):
        image_record["confirmed_capture_date"] = capture_date.strip() or None
        image_record["orientation"] = image_orientation
        image_record["confirmed_latitude"] = latitude
        image_record["confirmed_longitude"] = longitude
        image_record["location_source"] = source
        if update_tree:
            tree["latitude"] = latitude
            tree["longitude"] = longitude
            tree["location_source"] = source
        persist_project()
        st.success("Metadata y ubicación confirmadas.")


def create_morphotype(tree: dict[str, Any]) -> None:
    st.markdown("#### Morfotipos del árbol")
    with st.expander("Crear un nuevo tipo visual", expanded=not tree.get("morphotypes")):
        label = st.text_input(
            "Descripción corta",
            placeholder="Ej. gris verdoso, folioso con lóbulos anchos",
            key=f"new_morphotype_label_{tree['id']}",
        )
        growth_form = st.selectbox(
            "Forma de crecimiento",
            ["Crustoso", "Folioso", "Fruticuloso", "Escuamuloso", "Desconocido"],
            key=f"new_morphotype_growth_{tree['id']}",
        )
        if st.button("Crear morfotipo", key=f"create_morphotype_{tree['id']}"):
            if not label.strip():
                st.error("Escribe una descripción corta para distinguirlo.")
            else:
                index = len(tree.get("morphotypes", {})) + 1
                code = f"M{index}"
                tree.setdefault("morphotypes", {})[code] = {
                    "code": code,
                    "label": label.strip(),
                    "growth_form": growth_form,
                    "color": MORPHOTYPE_COLORS[(index - 1) % len(MORPHOTYPE_COLORS)],
                    "created_at": now_iso(),
                }
                persist_project()
                st.success(f"{code} creado. Ya puedes marcarlo sobre las imágenes.")
                st.rerun()
    if tree.get("morphotypes"):
        st.markdown(morphotype_legend(tree), unsafe_allow_html=True)


def roi_tab(image_record: dict[str, Any], image: Image.Image, tree: dict[str, Any]) -> None:
    st.write(
        "Arrastra desde una esquina hasta la esquina opuesta para definir la parte de corteza que se analizará."
    )
    overlay = draw_overlay(image, image_record, tree, "roi")
    value = streamlit_image_coordinates(
        overlay,
        width=850,
        click_and_drag=True,
        cursor="crosshair",
        key=f"roi_{image_record['id']}_{image_record.get('roi_version', 0)}",
    )
    if value and is_new_event(f"roi_{image_record['id']}", value):
        roi = normalized_roi(value)
        if roi:
            image_record["roi"] = roi
            image_record["grid"] = generate_grid(image_record)
            image_record["last_grid_index"] = None
            image_record["roi_version"] = image_record.get("roi_version", 0) + 1
            persist_project()
            st.rerun()
        else:
            st.error("El área seleccionada es demasiado pequeña.")
    if image_record.get("roi"):
        st.success("Área de análisis definida. Cambiarla reinicia las etiquetas de cobertura.")


def coverage_tab(image_record: dict[str, Any], image: Image.Image, tree: dict[str, Any]) -> None:
    st.markdown(class_legend(), unsafe_allow_html=True)
    morphotype_options = [
        f"Liquen · {code} · {item['label']}"
        for code, item in tree.get("morphotypes", {}).items()
    ]
    label_options = morphotype_options + [
        "Liquen · tipo aún no asignado",
        "Corteza",
        "Musgo",
        "Alga",
        "Sombra",
        "Reflejo",
        "Desconocido",
        "Fuera/no tronco",
    ]
    active_label = st.selectbox(
        "Clase que aplicarás al tocar un punto",
        label_options,
        key=f"coverage_label_{image_record['id']}",
    )
    st.caption(
        "Haz clic cerca del punto de la cuadrícula que quieres clasificar. "
        "Los puntos fueron generados automáticamente; no debes moverlos."
    )
    overlay = draw_overlay(image, image_record, tree, "coverage")
    value = streamlit_image_coordinates(
        overlay,
        width=850,
        cursor="crosshair",
        key=f"coverage_{image_record['id']}_{image_record.get('coverage_version', 0)}",
    )
    if value and is_new_event(f"coverage_{image_record['id']}", value):
        point = normalized_point(value)
        if point:
            x, y = point
            grid = image_record.get("grid") or generate_grid(image_record)
            nearest = min(
                grid,
                key=lambda item: (item["x"] - x) ** 2 + (item["y"] - y) ** 2,
            )
            distance = math.sqrt(
                (nearest["x"] - x) ** 2 + (nearest["y"] - y) ** 2
            )
            if distance <= 0.06:
                if active_label.startswith("Liquen"):
                    nearest["class"] = "Liquen"
                    code_match = re.search(r"Liquen · (M\d+)", active_label)
                    nearest["morphotype_code"] = (
                        code_match.group(1) if code_match else None
                    )
                else:
                    nearest["class"] = active_label
                    nearest["morphotype_code"] = None
                image_record["grid"] = grid
                image_record["last_grid_index"] = nearest["index"]
                image_record["coverage_version"] = (
                    image_record.get("coverage_version", 0) + 1
                )
                st.rerun()
            else:
                st.warning("Haz clic más cerca de uno de los 50 puntos.")

    metrics = image_analysis_metrics(image_record)
    col1, col2, col3 = st.columns(3)
    col1.metric("Puntos clasificados", f"{metrics['labeled_points']}/50")
    col2.metric(
        "Cobertura provisional",
        f"{metrics['cover_pct']:.1f}%" if metrics["cover_pct"] is not None else "—",
    )
    col3.metric(
        "Fracción evaluable",
        f"{metrics['assessable_pct']:.0f}%"
        if metrics["assessable_pct"] is not None
        else "—",
    )
    undo_col, clear_col = st.columns(2)
    labeled = [point for point in image_record.get("grid", []) if point.get("class")]
    if undo_col.button(
        "Deshacer última clasificación",
        disabled=not labeled,
        key=f"undo_grid_{image_record['id']}",
        width="stretch",
    ):
        last_index = image_record.get("last_grid_index")
        target = next(
            (
                point
                for point in image_record.get("grid", [])
                if point["index"] == last_index and point.get("class")
            ),
            labeled[-1],
        )
        target["class"] = None
        target["morphotype_code"] = None
        image_record["last_grid_index"] = None
        image_record["coverage_version"] = image_record.get("coverage_version", 0) + 1
        st.rerun()
    if clear_col.button(
        "Reiniciar las 50 etiquetas",
        disabled=not labeled,
        key=f"clear_grid_{image_record['id']}",
        width="stretch",
    ):
        image_record["grid"] = generate_grid(image_record)
        image_record["last_grid_index"] = None
        image_record["coverage_version"] = image_record.get("coverage_version", 0) + 1
        st.rerun()


def morphotype_tab(image_record: dict[str, Any], image: Image.Image, tree: dict[str, Any]) -> None:
    morphotypes = tree.get("morphotypes", {})
    if not morphotypes:
        st.info("Primero crea al menos un tipo visual en el panel superior.")
        return
    active_code = st.selectbox(
        "Tipo visual que marcarás",
        list(morphotypes),
        format_func=lambda code: f"{code} · {morphotypes[code]['label']}",
        key=f"active_morphotype_{image_record['id']}",
    )
    st.caption(
        "Haz clic sobre ejemplos representativos del tipo seleccionado. "
        "Estos puntos documentan morfotipos; no calculan el porcentaje de cobertura."
    )
    overlay = draw_overlay(image, image_record, tree, "morphotypes")
    value = streamlit_image_coordinates(
        overlay,
        width=850,
        cursor="crosshair",
        key=f"morph_{image_record['id']}_{image_record.get('morph_version', 0)}",
    )
    if value and is_new_event(f"morph_{image_record['id']}", value):
        point = normalized_point(value)
        if point:
            image_record.setdefault("morphotype_points", []).append(
                {
                    "x": point[0],
                    "y": point[1],
                    "morphotype_code": active_code,
                    "created_at": now_iso(),
                }
            )
            image_record["morph_version"] = image_record.get("morph_version", 0) + 1
            st.rerun()

    counts = {}
    for point in image_record.get("morphotype_points", []):
        code = point["morphotype_code"]
        counts[code] = counts.get(code, 0) + 1
    if counts:
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Código": code,
                        "Descripción": morphotypes[code]["label"],
                        "Forma": morphotypes[code]["growth_form"],
                        "Puntos": count,
                    }
                    for code, count in counts.items()
                ]
            ),
            width="stretch",
            hide_index=True,
        )
    undo_col, clear_col = st.columns(2)
    annotations = image_record.get("morphotype_points", [])
    if undo_col.button(
        "Deshacer último punto",
        disabled=not annotations,
        key=f"undo_morph_{image_record['id']}",
        width="stretch",
    ):
        annotations.pop()
        image_record["morph_version"] = image_record.get("morph_version", 0) + 1
        st.rerun()
    if clear_col.button(
        "Eliminar puntos de esta imagen",
        disabled=not annotations,
        key=f"clear_morph_{image_record['id']}",
        width="stretch",
    ):
        image_record["morphotype_points"] = []
        image_record["morph_version"] = image_record.get("morph_version", 0) + 1
        st.rerun()


def annotation_page() -> None:
    page_heading(
        "Anotación de la imagen",
        "Define el área analizada, clasifica la cuadrícula de cobertura y marca ejemplos de cada morfotipo.",
    )
    image_record = active_image()
    tree = active_tree()
    if not image_record or not tree:
        gate("Selecciona primero una imagen.", 3, "Ir a Imágenes")
        return
    image = get_pil_image(image_record)
    if image is None:
        st.error("No se puede abrir la imagen seleccionada.")
        return

    create_morphotype(tree)
    roi, coverage, morphotypes = st.tabs(
        ["1 · Área de análisis", "2 · Cobertura", "3 · Morfotipos"]
    )
    with roi:
        roi_tab(image_record, image, tree)
    with coverage:
        coverage_tab(image_record, image, tree)
    with morphotypes:
        morphotype_tab(image_record, image, tree)

    st.markdown("")
    save_col, another_col, finish_col = st.columns(3)
    if save_col.button("Guardar esta imagen", type="primary", width="stretch"):
        persist_project()
        st.success("Imagen, metadata y anotaciones guardadas.")
    if another_col.button("Otra imagen del mismo árbol", width="stretch"):
        go_to(3)
    if finish_col.button("Finalizar este árbol →", width="stretch"):
        persist_project()
        go_to(6)


def tree_summary_page() -> None:
    page_heading(
        "Resumen del árbol",
        "Combina las imágenes del mismo árbol sin contar cada fotografía como un árbol diferente.",
    )
    tree = active_tree()
    site = active_site()
    if not tree or not site:
        gate("Selecciona primero un árbol.", 2, "Ir a Árbol o sustrato")
        return

    rows = []
    covers = []
    observed_codes = set()
    for image in tree.get("images", []):
        metrics = image_analysis_metrics(image)
        if metrics["valid_image"]:
            covers.append(metrics["cover_pct"])
        observed_codes.update(
            point["morphotype_code"] for point in image.get("morphotype_points", [])
        )
        rows.append(
            {
                "Imagen": image["name"],
                "Fecha": image.get("confirmed_capture_date") or "—",
                "Puntos": f"{metrics['labeled_points']}/50",
                "Cobertura": (
                    f"{metrics['cover_pct']:.1f}%"
                    if metrics["cover_pct"] is not None
                    else "—"
                ),
                "Evaluable": (
                    f"{metrics['assessable_pct']:.0f}%"
                    if metrics["assessable_pct"] is not None
                    else "—"
                ),
                "Morfotipos marcados": len(
                    {point["morphotype_code"] for point in image.get("morphotype_points", [])}
                ),
            }
        )
    col1, col2, col3 = st.columns(3)
    col1.metric("Imágenes", len(tree.get("images", [])))
    col2.metric(
        "Cobertura media válida",
        f"{sum(covers) / len(covers):.1f}%" if covers else "Pendiente",
    )
    col3.metric("Morfotipos visibles en el árbol", len(observed_codes))
    if rows:
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    else:
        st.warning("Este árbol todavía no contiene imágenes.")

    if tree.get("latitude") is not None:
        distance = haversine_m(
            site["center_latitude"],
            site["center_longitude"],
            tree["latitude"],
            tree["longitude"],
        )
        if distance <= site["radius_m"]:
            st.success(
                f"El árbol está a {distance:.0f} m del centro y dentro del radio de {site['radius_m']} m."
            )
        else:
            st.warning(
                f"El árbol está a {distance:.0f} m del centro y fuera del radio de {site['radius_m']} m."
            )
    else:
        st.warning("El árbol no tiene una ubicación confirmada.")

    save_col, add_image_col, add_tree_col, site_col = st.columns(4)
    if save_col.button("Guardar árbol", type="primary", width="stretch"):
        persist_project()
        st.success("Árbol guardado.")
    if add_image_col.button("Añadir imagen", width="stretch"):
        go_to(3)
    if add_tree_col.button("Añadir otro árbol", width="stretch"):
        st.session_state.active_tree_id = None
        st.session_state.active_image_id = None
        go_to(2)
    if site_col.button("Resumen del sitio →", width="stretch"):
        go_to(7)


def site_summary_page() -> None:
    page_heading(
        "Resumen del sitio",
        "Agrega primero por imagen, luego por árbol y finalmente dentro del radio del sitio.",
    )
    site = active_site()
    if not site:
        gate("Selecciona primero un sitio.", 1, "Ir a Sitio de muestreo")
        return
    data = tree_rows(site)
    registered_trees = len(data)
    registered_images = (
        int(data["number_of_images"].sum()) if not data.empty else 0
    )
    inside = data[data["inside_radius"] == True] if not data.empty else data
    sampled_inside = (
        inside[inside["valid_images"] >= 1] if not inside.empty else inside
    )
    eligible_trees = len(sampled_inside)
    number_images = (
        int(inside["number_of_images"].sum()) if not inside.empty else 0
    )
    valid_images = int(inside["valid_images"].sum()) if not inside.empty else 0
    inside_count = len(inside)
    covers = (
        sampled_inside["mean_cover_pct"].dropna().tolist()
        if not sampled_inside.empty
        else []
    )

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Árboles muestreados en radio", eligible_trees)
    col2.metric("Imágenes en radio", number_images)
    col3.metric("Imágenes válidas en radio", valid_images)
    col4.metric(
        "Cobertura media por árbol",
        f"{sum(covers) / len(covers):.1f}%" if covers else "Pendiente",
    )

    map_rows = data.dropna(subset=["latitude", "longitude"]) if not data.empty else data
    if not map_rows.empty:
        st.map(
            map_rows.rename(columns={"latitude": "lat", "longitude": "lon"})[
                ["lat", "lon"]
            ],
            zoom=13,
            height=420,
        )
    st.caption(
        f"Registrados: {registered_trees} árbol(es) y {registered_images} imagen(es). "
        f"{inside_count} árbol(es) con coordenadas están dentro del radio de "
        f"{site['radius_m']} m; {eligible_trees} tienen al menos una imagen válida."
    )

    if not data.empty:
        display = data.copy()
        display["distance_to_site_center_m"] = pd.to_numeric(
            display["distance_to_site_center_m"], errors="coerce"
        ).round(1)
        display["mean_cover_pct"] = pd.to_numeric(
            display["mean_cover_pct"], errors="coerce"
        ).round(1)
        st.dataframe(display, width="stretch", hide_index=True)

    st.markdown("#### Elegibilidad para una señal ambiental del sitio")
    st.progress(min(eligible_trees / 5, 1.0))
    st.write(
        f"**{eligible_trees} de 5 árboles mínimos dentro del radio, "
        "cada uno con ≥1 imagen válida**"
    )
    st.progress(min(valid_images / 10, 1.0))
    st.write(f"**{valid_images} de 10 imágenes válidas dentro del radio**")
    if eligible_trees >= 5 and valid_images >= 10:
        st.success(
            "El sitio alcanza el mínimo operativo de muestreo. La categoría ambiental "
            "seguirá siendo provisional hasta contar con calibración dominicana."
        )
    else:
        st.warning(
            "Datos insuficientes para una categoría ambiental del sitio. "
            "Continúa añadiendo árboles e imágenes válidas."
        )
    st.markdown(
        """
        <div class="scientific-note">
            <b>Diversidad del sitio:</b> los códigos M1, M2, etc. son comparables entre
            imágenes del mismo árbol. No deben sumarse automáticamente entre árboles
            como si fueran especies; más adelante añadiremos una reconciliación visual
            entre árboles.
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown("")
    save_col, add_tree_col, export_col = st.columns(3)
    if save_col.button("Guardar sitio", type="primary", width="stretch"):
        persist_project()
        st.success("Sitio completo guardado localmente.")
    if add_tree_col.button("Añadir otro árbol", width="stretch"):
        st.session_state.active_tree_id = None
        st.session_state.active_image_id = None
        go_to(2)
    if export_col.button("Ir a exportación →", width="stretch"):
        go_to(8)


def export_page() -> None:
    page_heading(
        "Guardar y exportar",
        "Descarga información separada por imagen y por árbol para conservar la jerarquía científica.",
    )
    image_data = image_rows()
    tree_data = tree_rows()
    point_data = annotation_rows()
    image_tab, tree_tab, point_tab = st.tabs(
        ["CSV por imagen", "CSV por árbol", "CSV de puntos"]
    )
    with image_tab:
        if image_data.empty:
            st.info("Todavía no hay imágenes para exportar.")
        else:
            st.dataframe(image_data, width="stretch", hide_index=True)
            st.download_button(
                "Descargar CSV por imagen",
                data=image_data.to_csv(index=False).encode("utf-8"),
                file_name="lichendr_imagenes.csv",
                mime="text/csv",
                type="primary",
            )
    with tree_tab:
        if tree_data.empty:
            st.info("Todavía no hay árboles para exportar.")
        else:
            st.dataframe(tree_data, width="stretch", hide_index=True)
            st.download_button(
                "Descargar CSV por árbol",
                data=tree_data.to_csv(index=False).encode("utf-8"),
                file_name="lichendr_arboles.csv",
                mime="text/csv",
                type="primary",
            )
    with point_tab:
        if point_data.empty:
            st.info("Todavía no hay puntos para exportar.")
        else:
            st.dataframe(point_data, width="stretch", hide_index=True)
            st.download_button(
                "Descargar CSV de puntos",
                data=point_data.to_csv(index=False).encode("utf-8"),
                file_name="lichendr_puntos.csv",
                mime="text/csv",
                type="primary",
            )
    st.markdown("")
    save_col, backup_col = st.columns(2)
    if save_col.button("Guardar todo el proyecto", type="primary", width="stretch"):
        persist_project()
        st.success(
            "Sitios, árboles, imágenes, metadata y anotaciones guardados localmente."
        )
    backup_col.download_button(
        "Descargar respaldo JSON",
        data=export_project_json(),
        file_name="lichendr_respaldo.json",
        mime="application/json",
        width="stretch",
    )
    st.caption(
        "En esta versión los datos se guardan dentro del Codespace. "
        "La siguiente etapa los migrará a Supabase para almacenamiento permanente."
    )


def main() -> None:
    initialize_state()
    inject_css()
    sidebar()
    pages = [
        home_page,
        site_page,
        tree_page,
        images_page,
        metadata_page,
        annotation_page,
        tree_summary_page,
        site_summary_page,
        export_page,
    ]
    pages[st.session_state.step]()
    if st.session_state.step != 0:
        navigation()


if __name__ == "__main__":
    main()
