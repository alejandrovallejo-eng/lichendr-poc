from __future__ import annotations

from datetime import datetime
from io import BytesIO
from random import Random
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st
from PIL import Image, ImageDraw


st.set_page_config(
    page_title="LichenDR · Prototipo",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="expanded",
)

STEPS = [
    "Inicio",
    "Cargar imágenes",
    "Revisar metadata",
    "Ubicación",
    "Información de campo",
    "Análisis",
    "Resultado",
    "Observaciones",
    "Exportar",
]

CLASS_COLORS = {
    "Liquen": "#4E8F56",
    "Corteza": "#9A6846",
    "Musgo": "#315E3B",
    "Alga": "#168C84",
    "Sombra": "#59636D",
    "Reflejo": "#F3C74E",
    "Desconocido": "#8A5CA8",
}

DEMO_COUNTS = {
    "Liquen": 22,
    "Corteza": 18,
    "Musgo": 4,
    "Alga": 2,
    "Sombra": 2,
    "Reflejo": 1,
    "Desconocido": 1,
}


def initialize_state() -> None:
    defaults = {
        "step": 0,
        "observation_id": "DR-LICH-2026-0001",
        "latitude": 18.4861,
        "longitude": -69.9312,
        "location_source": "Manual (mapa)",
        "field_data": {},
        "image_records": [],
        "growth_forms": ["Crustoso", "Folioso"],
        "morphotypes": 3,
        "confidence": 0.82,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


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
            --lichen-cream: #f7f4ec;
        }
        .block-container {
            padding-top: 1.6rem;
            padding-bottom: 3rem;
            max-width: 1250px;
        }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #15364a 0%, #204e5e 100%);
        }
        [data-testid="stSidebar"] * {
            color: #ffffff;
        }
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
            padding: 2.2rem;
            border-radius: 22px;
            background:
                radial-gradient(circle at 85% 20%, rgba(255,255,255,.18), transparent 28%),
                linear-gradient(135deg, #15364a, #2e6b66);
            color: white;
            margin-bottom: 1.2rem;
        }
        .hero h1 {
            color: white;
            font-size: 2.8rem;
            margin: 0 0 .55rem 0;
        }
        .hero p {
            font-size: 1.08rem;
            max-width: 760px;
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
            padding: 1.1rem 1.25rem;
            border: 1px solid #dfe7ea;
            border-radius: 16px;
            background: #ffffff;
            min-height: 120px;
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
        .step-caption {
            color: #65727a;
            font-size: .93rem;
            margin-bottom: 1.25rem;
        }
        .legend-row {
            display: flex;
            flex-wrap: wrap;
            gap: .55rem;
            margin: .6rem 0 1rem 0;
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


def sidebar() -> None:
    with st.sidebar:
        st.markdown("## 🌿 LichenDR")
        st.caption("Prueba de concepto · República Dominicana")
        st.progress((st.session_state.step + 1) / len(STEPS))
        st.caption(f"Paso {st.session_state.step + 1} de {len(STEPS)}")
        st.markdown("---")
        for index, label in enumerate(STEPS):
            prefix = "●" if index == st.session_state.step else "○"
            if st.button(
                f"{prefix}  {label}",
                key=f"sidebar_step_{index}",
                width="stretch",
            ):
                go_to(index)
        st.markdown("---")
        st.caption("Método previsto: conteo manual de 50 puntos")
        st.caption("Versión de interfaz: mockup 0.1")


def page_heading(title: str, description: str) -> None:
    st.title(title)
    st.markdown(f'<div class="step-caption">{description}</div>', unsafe_allow_html=True)


def navigation() -> None:
    st.markdown("---")
    left, middle, right = st.columns([1, 4, 1])
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


def uploaded_image_records() -> list[dict]:
    return st.session_state.get("image_records", [])


def first_image() -> Image.Image | None:
    records = uploaded_image_records()
    if not records:
        return None
    try:
        return Image.open(BytesIO(records[0]["bytes"])).convert("RGB")
    except Exception:
        return None


def placeholder_image() -> Image.Image:
    image = Image.new("RGB", (1200, 820), "#b8936f")
    draw = ImageDraw.Draw(image)
    rng = Random(24072026)
    for _ in range(150):
        x = rng.randint(0, image.width)
        y = rng.randint(0, image.height)
        length = rng.randint(35, 180)
        shade = rng.choice(["#8a6248", "#a77959", "#c3a17b", "#76513e"])
        draw.line((x, y, min(image.width, x + length), y + rng.randint(-18, 18)), fill=shade, width=rng.randint(2, 7))
    draw.rounded_rectangle((325, 325, 875, 495), radius=20, fill="#f7f4ec", outline="#15364a", width=4)
    draw.text((390, 375), "IMAGEN DE DEMOSTRACION", fill="#15364a")
    draw.text((420, 425), "Carga una foto real en el paso 2", fill="#4c5962")
    return image


def analysis_overlay() -> Image.Image:
    image = first_image() or placeholder_image()
    image.thumbnail((1200, 900))
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size
    margin_x = int(width * 0.08)
    margin_y = int(height * 0.08)
    roi = (margin_x, margin_y, width - margin_x, height - margin_y)
    draw.rectangle(roi, outline="#ffffff", width=max(3, width // 280))

    labels: list[str] = []
    for label, count in DEMO_COUNTS.items():
        labels.extend([label] * count)
    rng = Random(5001)
    rng.shuffle(labels)

    roi_width = roi[2] - roi[0]
    roi_height = roi[3] - roi[1]
    radius = max(7, width // 95)
    for index, label in enumerate(labels):
        row, col = divmod(index, 10)
        cell_x = roi_width / 10
        cell_y = roi_height / 5
        x = roi[0] + (col + rng.uniform(0.25, 0.75)) * cell_x
        y = roi[1] + (row + rng.uniform(0.25, 0.75)) * cell_y
        color = CLASS_COLORS[label]
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=color + "E8",
            outline="#ffffff",
            width=max(2, radius // 4),
        )
    return image


def legend_html() -> str:
    chips = []
    for label, color in CLASS_COLORS.items():
        chips.append(
            f'<span class="legend-chip"><span class="legend-dot" '
            f'style="background:{color}"></span>{label}</span>'
        )
    return '<div class="legend-row">' + "".join(chips) + "</div>"


def demo_rows() -> pd.DataFrame:
    current = st.session_state.field_data
    return pd.DataFrame(
        [
            {
                "observation_id": "DR-LICH-2026-0001",
                "fecha": "2026-07-24",
                "sitio": current.get("site_name", "Santo Domingo · Sitio piloto"),
                "árbol": current.get("tree_code", "T-001"),
                "fotos": max(1, len(uploaded_image_records())),
                "cobertura_pct": 47.8,
                "morfotipos": st.session_state.morphotypes,
                "confianza": st.session_state.confidence,
                "estado": "Borrador",
            },
            {
                "observation_id": "DR-LICH-DEMO-0002",
                "fecha": "2026-07-21",
                "sitio": "Parque urbano · Demo",
                "árbol": "T-002",
                "fotos": 2,
                "cobertura_pct": 31.2,
                "morfotipos": 2,
                "confianza": 0.76,
                "estado": "Demostración",
            },
            {
                "observation_id": "DR-LICH-DEMO-0003",
                "fecha": "2026-07-19",
                "sitio": "Avenida principal · Demo",
                "árbol": "T-003",
                "fotos": 2,
                "cobertura_pct": 12.5,
                "morfotipos": 1,
                "confianza": 0.71,
                "estado": "Demostración",
            },
        ]
    )


def home_page() -> None:
    st.markdown(
        """
        <div class="hero">
            <div class="eyebrow">Biomonitoreo participativo y trazable</div>
            <h1>LichenDR</h1>
            <p>
                Registra fotografías de líquenes, documenta su ubicación y contexto,
                y produce mediciones reproducibles de cobertura para investigación
                ambiental en la República Dominicana.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown(
            '<div class="soft-card"><b>1 · Documentar</b><br><br>'
            "Fotografías, GPS, árbol, sustrato y contexto del sitio.</div>",
            unsafe_allow_html=True,
        )
    with col2:
        st.markdown(
            '<div class="soft-card"><b>2 · Medir</b><br><br>'
            "Conteo revisable de 50 puntos dentro de un área definida.</div>",
            unsafe_allow_html=True,
        )
    with col3:
        st.markdown(
            '<div class="soft-card"><b>3 · Comparar</b><br><br>'
            "Resultados por árbol, sitio y, en el futuro, radios geográficos.</div>",
            unsafe_allow_html=True,
        )
    st.markdown("")
    st.markdown(
        """
        <div class="scientific-note">
            <b>Límite científico:</b> este prototipo describe una señal biológica basada
            en líquenes. No mide directamente contaminantes, no produce un AQI regulatorio
            y no identifica especies automáticamente.
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown("")
    if st.button("Crear nueva observación", type="primary", width="content"):
        go_to(1)


def upload_page() -> None:
    page_heading(
        "Cargar imágenes",
        "Una observación representa un árbol o sustrato durante una visita y puede contener varias fotografías.",
    )
    files = st.file_uploader(
        "Selecciona una o más fotografías",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True,
        help="En la fase 1 se aceptan JPG y PNG. HEIC se incorporará posteriormente.",
    )
    if files:
        records = []
        for file in files:
            raw = file.getvalue()
            record = {
                "name": file.name,
                "type": file.type,
                "size": len(raw),
                "bytes": raw,
            }
            try:
                image = Image.open(BytesIO(raw))
                record["width"], record["height"] = image.size
            except Exception:
                record["width"], record["height"] = None, None
            records.append(record)
        st.session_state.image_records = records

    records = uploaded_image_records()
    if records:
        st.success(f"{len(records)} imagen(es) preparada(s) para esta demostración.")
        columns = st.columns(min(3, len(records)))
        for index, record in enumerate(records):
            with columns[index % len(columns)]:
                try:
                    st.image(record["bytes"], caption=record["name"], width="stretch")
                except Exception:
                    st.error(f"No se pudo mostrar {record['name']}.")
                st.caption(
                    f"{record.get('width', '—')} × {record.get('height', '—')} px · "
                    f"{record['size'] / 1_048_576:.2f} MB"
                )
    else:
        st.info("Puedes continuar sin una foto; el mockup utilizará una imagen de demostración.")


def metadata_page() -> None:
    page_heading(
        "Revisar metadata",
        "La versión funcional conservará la metadata original y separará el GPS EXIF de la ubicación confirmada.",
    )
    records = uploaded_image_records()
    if not records:
        st.warning("No se cargó una imagen. Se muestran valores simulados para revisar la interfaz.")
        records = [
            {
                "name": "foto_lichen_demo.jpg",
                "type": "image/jpeg",
                "size": 2_450_000,
                "width": 3024,
                "height": 4032,
            }
        ]
    selected = st.selectbox("Imagen", [record["name"] for record in records])
    record = next(item for item in records if item["name"] == selected)
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Formato", record.get("type", "—"))
    col2.metric("Tamaño", f"{record.get('size', 0) / 1_048_576:.2f} MB")
    col3.metric("Ancho", f"{record.get('width', '—')} px")
    col4.metric("Alto", f"{record.get('height', '—')} px")
    st.markdown("#### Metadata prevista")
    metadata = pd.DataFrame(
        [
            ["Fecha de captura", "Pendiente de extracción EXIF", "Automático"],
            ["Fabricante/modelo", "Pendiente de extracción EXIF", "Automático"],
            ["Orientación", "Pendiente de extracción EXIF", "Automático"],
            ["GPS EXIF", "No confirmado en el mockup", "Automático + revisión"],
            ["Fecha de carga", datetime.now(ZoneInfo("America/Santo_Domingo")).strftime("%Y-%m-%d %H:%M"), "Servidor"],
        ],
        columns=["Campo", "Valor", "Origen"],
    )
    st.dataframe(metadata, width="stretch", hide_index=True)
    st.checkbox("Confirmo que revisaré la fecha y el GPS antes de finalizar", value=True)


def location_page() -> None:
    page_heading(
        "Confirmar ubicación",
        "El marcador representa la ubicación canónica. En fases posteriores podrá originarse en EXIF, GPS del dispositivo o entrada manual.",
    )
    col1, col2 = st.columns([1, 1.5])
    with col1:
        latitude = st.number_input(
            "Latitud",
            min_value=-90.0,
            max_value=90.0,
            value=float(st.session_state.latitude),
            format="%.6f",
        )
        longitude = st.number_input(
            "Longitud",
            min_value=-180.0,
            max_value=180.0,
            value=float(st.session_state.longitude),
            format="%.6f",
        )
        source = st.selectbox(
            "Fuente de ubicación",
            ["EXIF", "Manual (mapa)", "Coordenadas manuales", "GPS del dispositivo", "Desconocida"],
            index=1,
        )
        uncertainty = st.number_input(
            "Incertidumbre/precisión aproximada (m)",
            min_value=0,
            value=25,
            step=5,
        )
        st.session_state.latitude = latitude
        st.session_state.longitude = longitude
        st.session_state.location_source = source
        if st.button("Confirmar ubicación", type="primary"):
            st.success("Ubicación confirmada para el mockup.")
    with col2:
        map_data = pd.DataFrame({"lat": [latitude], "lon": [longitude]})
        st.map(map_data, zoom=12, height=430)
        st.caption(
            f"Ubicación demostrativa: {latitude:.6f}, {longitude:.6f} · "
            f"incertidumbre {uncertainty} m"
        )


def field_page() -> None:
    page_heading(
        "Información de campo",
        "Registra las variables necesarias para interpretar la cobertura sin confundirla automáticamente con contaminación.",
    )
    existing = st.session_state.field_data
    with st.form("field_form"):
        left, right = st.columns(2)
        with left:
            site_name = st.text_input(
                "Nombre del sitio *",
                value=existing.get("site_name", "Sitio piloto Santo Domingo"),
            )
            tree_code = st.text_input(
                "Código del árbol *",
                value=existing.get("tree_code", "T-001"),
            )
            tree_species = st.text_input(
                "Especie del árbol, si se conoce",
                value=existing.get("tree_species", ""),
                placeholder="Puede dejarse en blanco",
            )
            substrate = st.selectbox(
                "Tipo de sustrato *",
                ["Corteza de árbol", "Madera muerta", "Roca", "Superficie artificial", "Otro"],
            )
            orientation = st.selectbox(
                "Orientación del tronco *",
                ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "Desconocida"],
            )
        with right:
            height_cm = st.number_input(
                "Altura aproximada de muestreo (cm) *",
                min_value=0,
                max_value=500,
                value=int(existing.get("height_cm", 150)),
            )
            shade = st.selectbox(
                "Nivel de sombra",
                ["Sol abierto", "Sombra parcial", "Sombra profunda", "Desconocido"],
            )
            nearby_road = st.checkbox("Hay una carretera cercana")
            road_distance = st.number_input(
                "Distancia aproximada a la carretera (m)",
                min_value=0,
                value=20,
                disabled=not nearby_road,
            )
            pollution_source = st.checkbox("Hay una fuente potencial de contaminación cercana")
            notes = st.text_area(
                "Notas",
                placeholder="Estado de la corteza, humedad, lluvia, daños, dudas u otras observaciones.",
            )
        submitted = st.form_submit_button("Guardar información de campo", type="primary")
        if submitted:
            st.session_state.field_data = {
                "site_name": site_name,
                "tree_code": tree_code,
                "tree_species": tree_species,
                "substrate": substrate,
                "orientation": orientation,
                "height_cm": height_cm,
                "shade": shade,
                "nearby_road": nearby_road,
                "road_distance": road_distance if nearby_road else None,
                "pollution_source": pollution_source,
                "notes": notes,
            }
            st.success("Información guardada temporalmente en esta sesión.")


def analysis_page() -> None:
    page_heading(
        "Análisis de cobertura",
        "Demostración del futuro conteo estratificado de 50 puntos. Los puntos todavía no son editables en esta fase.",
    )
    st.markdown(legend_html(), unsafe_allow_html=True)
    left, right = st.columns([1.55, 1])
    with left:
        st.image(
            analysis_overlay(),
            caption="ROI y 50 puntos de demostración; no es un resultado científico.",
            width="stretch",
        )
    with right:
        st.markdown("#### Conteo simulado")
        count_table = pd.DataFrame(
            [{"Clase": key, "Puntos": value} for key, value in DEMO_COUNTS.items()]
        )
        st.dataframe(count_table, width="stretch", hide_index=True)
        valid = sum(DEMO_COUNTS[key] for key in ["Liquen", "Corteza", "Musgo", "Alga"])
        cover = 100 * DEMO_COUNTS["Liquen"] / valid
        assessable = 100 * valid / sum(DEMO_COUNTS.values())
        metric1, metric2 = st.columns(2)
        metric1.metric("Cobertura", f"{cover:.1f}%")
        metric2.metric("Evaluable", f"{assessable:.0f}%")
        st.session_state.morphotypes = st.number_input(
            "Morfotipos visibles",
            min_value=0,
            max_value=30,
            value=int(st.session_state.morphotypes),
        )
        st.session_state.growth_forms = st.multiselect(
            "Formas de crecimiento",
            ["Crustoso", "Folioso", "Fruticuloso", "Escuamuloso", "Desconocido"],
            default=st.session_state.growth_forms,
        )
        st.session_state.confidence = st.slider(
            "Confianza del revisor",
            min_value=0.0,
            max_value=1.0,
            value=float(st.session_state.confidence),
            step=0.05,
        )


def result_page() -> None:
    page_heading(
        "Resultado de la observación",
        "La medición se presenta junto con su método, calidad de imagen y limitaciones.",
    )
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Cobertura de liquen", "47.8%")
    col2.metric("Área evaluable", "92%")
    col3.metric("Morfotipos visibles", st.session_state.morphotypes)
    col4.metric("Confianza", f"{st.session_state.confidence:.0%}")
    st.markdown("")
    left, right = st.columns([1.4, 1])
    with left:
        st.markdown(
            """
            <div class="success-note">
                <b>Resultado de la imagen:</b> cobertura estimada mediante un conteo
                simulado de 50 puntos. La fracción evaluable supera el umbral previsto
                de 80%.
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.markdown("")
        st.markdown("#### Formas de crecimiento registradas")
        st.write(", ".join(st.session_state.growth_forms) or "No registradas")
    with right:
        st.markdown("#### Estado de muestreo del sitio")
        st.progress(1 / 5)
        st.write("**1 de 5 árboles mínimos**")
        st.progress(min(max(1, len(uploaded_image_records())) / 10, 1.0))
        st.write(f"**{max(1, len(uploaded_image_records()))} de 10 fotos mínimas**")
    st.warning(
        "Datos insuficientes para una categoría ambiental del sitio. "
        "Se requieren al menos 5 árboles distintos, 10 fotografías válidas y ubicación confirmada."
    )
    st.caption(
        "La diversidad de especies no puede estimarse de forma confiable a partir de estas fotografías sin un sistema validado."
    )


def observations_page() -> None:
    page_heading(
        "Observaciones",
        "Vista de demostración para buscar, comparar y reabrir registros.",
    )
    search = st.text_input("Buscar por ID, sitio o árbol", placeholder="Ej. T-001")
    data = demo_rows()
    if search:
        mask = data.astype(str).apply(
            lambda column: column.str.contains(search, case=False, na=False)
        ).any(axis=1)
        data = data[mask]
    st.dataframe(data, width="stretch", hide_index=True)
    st.caption(
        "Las filas marcadas como demostración son ficticias y desaparecerán cuando conectemos la base de datos."
    )


def export_page() -> None:
    page_heading(
        "Exportar datos",
        "El CSV final utilizará una fila por imagen analizada y conservará el método y la procedencia de cada dato.",
    )
    data = demo_rows()
    st.dataframe(data, width="stretch", hide_index=True)
    csv_bytes = data.to_csv(index=False).encode("utf-8")
    st.download_button(
        "Descargar CSV de demostración",
        data=csv_bytes,
        file_name="lichendr_observaciones_demo.csv",
        mime="text/csv",
        type="primary",
    )
    st.markdown("")
    st.markdown(
        """
        <div class="scientific-note">
            <b>Privacidad:</b> en una versión pública podremos generalizar u ocultar
            coordenadas sensibles antes de exportar o compartir registros.
        </div>
        """,
        unsafe_allow_html=True,
    )


def main() -> None:
    initialize_state()
    inject_css()
    sidebar()
    pages = [
        home_page,
        upload_page,
        metadata_page,
        location_page,
        field_page,
        analysis_page,
        result_page,
        observations_page,
        export_page,
    ]
    pages[st.session_state.step]()
    if st.session_state.step != 0:
        navigation()


if __name__ == "__main__":
    main()
