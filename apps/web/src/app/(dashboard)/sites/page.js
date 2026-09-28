"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = SitesPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const PageHeader_1 = __importDefault(require("@/components/PageHeader"));
const client_1 = require("@/modules/projects/client");
const client_2 = require("@/modules/sites/client");
exports.dynamic = "force-dynamic";
const radiusOptions = [
    { value: 50, label: "50 m" },
    { value: 100, label: "100 m" },
    { value: 250, label: "250 m" },
    { value: 500, label: "500 m" },
    { value: 1000, label: "1 km" },
];
function SitesPage() {
    const [projects, setProjects] = (0, react_1.useState)([]);
    const [selectedProjectId, setSelectedProjectId] = (0, react_1.useState)(undefined);
    const [sites, setSites] = (0, react_1.useState)([]);
    const [loadingProjects, setLoadingProjects] = (0, react_1.useState)(false);
    const [loadingSites, setLoadingSites] = (0, react_1.useState)(false);
    const [submitting, setSubmitting] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [successMessage, setSuccessMessage] = (0, react_1.useState)(null);
    const [name, setName] = (0, react_1.useState)("");
    const [description, setDescription] = (0, react_1.useState)("");
    const [province, setProvince] = (0, react_1.useState)("");
    const [municipality, setMunicipality] = (0, react_1.useState)("");
    const [latitude, setLatitude] = (0, react_1.useState)("");
    const [longitude, setLongitude] = (0, react_1.useState)("");
    const [gpsAccuracyM, setGpsAccuracyM] = (0, react_1.useState)("");
    const [radiusM, setRadiusM] = (0, react_1.useState)(100);
    const [notes, setNotes] = (0, react_1.useState)("");
    const selectedProject = (0, react_1.useMemo)(() => projects.find((project) => project.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
    (0, react_1.useEffect)(() => {
        async function loadProjects() {
            setLoadingProjects(true);
            setError(null);
            const { projects: loadedProjects, error: projectsError } = await (0, client_1.fetchProjects)();
            if (projectsError) {
                setError(projectsError);
                setProjects([]);
            }
            else {
                setProjects(loadedProjects);
                const projectId = new URLSearchParams(window.location.search).get("projectId") ?? undefined;
                if (projectId && loadedProjects.some((project) => project.id === projectId)) {
                    setSelectedProjectId(projectId);
                }
                else if (!selectedProjectId && loadedProjects.length > 0) {
                    setSelectedProjectId(loadedProjects[0].id);
                }
            }
            setLoadingProjects(false);
        }
        loadProjects();
    }, [selectedProjectId, setSelectedProjectId]);
    (0, react_1.useEffect)(() => {
        const projectId = selectedProjectId;
        if (!projectId) {
            return;
        }
        async function loadSites(projectId) {
            setLoadingSites(true);
            setError(null);
            const { sites: loadedSites, error: sitesError } = await (0, client_2.fetchSitesByProject)(projectId);
            if (sitesError) {
                setError(sitesError);
                setSites([]);
            }
            else {
                setSites(loadedSites);
            }
            setLoadingSites(false);
        }
        loadSites(projectId);
    }, [selectedProjectId]);
    const validateSiteForm = () => {
        if (!selectedProjectId) {
            return "Selecciona un proyecto.";
        }
        if (!name.trim()) {
            return "El nombre del sitio es obligatorio.";
        }
        if (name.trim().length > 120) {
            return "El nombre no puede tener más de 120 caracteres.";
        }
        const latitudeValue = latitude.trim();
        const longitudeValue = longitude.trim();
        if ((latitudeValue && !longitudeValue) || (!latitudeValue && longitudeValue)) {
            return "Latitud y longitud deben ingresarse juntas.";
        }
        if (latitudeValue) {
            const parsedLatitude = Number(latitudeValue);
            if (Number.isNaN(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
                return "La latitud debe estar entre -90 y 90.";
            }
        }
        if (longitudeValue) {
            const parsedLongitude = Number(longitudeValue);
            if (Number.isNaN(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
                return "La longitud debe estar entre -180 y 180.";
            }
        }
        if (gpsAccuracyM.trim()) {
            const parsedAccuracy = Number(gpsAccuracyM);
            if (Number.isNaN(parsedAccuracy) || parsedAccuracy < 0) {
                return "La precisión GPS debe ser mayor o igual a 0.";
            }
        }
        return null;
    };
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setSuccessMessage(null);
        const validationError = validateSiteForm();
        if (validationError) {
            setError(validationError);
            return;
        }
        if (!selectedProjectId) {
            setError("Selecciona un proyecto.");
            return;
        }
        setSubmitting(true);
        const latitudeNumber = latitude.trim() ? Number(latitude.trim()) : undefined;
        const longitudeNumber = longitude.trim() ? Number(longitude.trim()) : undefined;
        const gpsAccuracyNumber = gpsAccuracyM.trim() ? Number(gpsAccuracyM.trim()) : undefined;
        const { site, error: createError } = await (0, client_2.createSite)({
            projectId: selectedProjectId,
            name: name.trim(),
            description: description.trim() || undefined,
            province: province.trim() || undefined,
            municipality: municipality.trim() || undefined,
            latitude: latitudeNumber,
            longitude: longitudeNumber,
            gpsAccuracyM: gpsAccuracyNumber,
            radiusM,
            notes: notes.trim() || undefined,
        });
        if (createError) {
            if (createError.toLowerCase().includes("unique") || createError.toLowerCase().includes("duplicate")) {
                setError("Ya existe un sitio con ese nombre en este proyecto.");
            }
            else {
                setError("No se pudo crear el sitio. Intenta de nuevo.");
            }
            setSubmitting(false);
            return;
        }
        if (site) {
            setSites((current) => [site, ...current]);
            setName("");
            setDescription("");
            setProvince("");
            setMunicipality("");
            setLatitude("");
            setLongitude("");
            setGpsAccuracyM("");
            setRadiusM(100);
            setNotes("");
            setSuccessMessage("Sitio guardado correctamente.");
        }
        setSubmitting(false);
    };
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)(PageHeader_1.default, { title: "Sitios", subtitle: "Administra los sitios asociados a tus proyectos." }), (0, jsx_runtime_1.jsx)("section", { className: "mb-6", style: { color: "var(--ld-text-secondary)" }, children: (0, jsx_runtime_1.jsx)("p", { className: "text-sm", children: "Cada proyecto puede tener m\u00FAltiples sitios. Crea y administra sitios para tus muestreos ambientales." }) }), loadingProjects ? ((0, jsx_runtime_1.jsx)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "var(--ld-card)", border: "1px solid var(--ld-border)" }, children: "Cargando proyectos..." })) : projects.length === 0 ? ((0, jsx_runtime_1.jsxs)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "var(--ld-card)", border: "1px solid var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("p", { children: "No hay proyectos a\u00FAn." }), (0, jsx_runtime_1.jsx)("a", { href: "/projects", className: "text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "Primero debes crear un proyecto." })] })) : ((0, jsx_runtime_1.jsxs)("section", { className: "mb-6 p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Seleccionar proyecto" }), (0, jsx_runtime_1.jsx)("label", { className: "block mb-3 text-sm font-medium", style: { color: "var(--ld-text)" }, htmlFor: "project-select", children: "Proyecto" }), (0, jsx_runtime_1.jsxs)("select", { id: "project-select", value: selectedProjectId || "", onChange: (event) => setSelectedProjectId(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Selecciona un proyecto" }), projects.map((project) => ((0, jsx_runtime_1.jsx)("option", { value: project.id, children: project.name }, project.id)))] })] })), projects.length > 0 && selectedProject ? ((0, jsx_runtime_1.jsxs)("section", { className: "mb-6 p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Nuevo sitio" }), (0, jsx_runtime_1.jsxs)("form", { onSubmit: handleSubmit, className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-name", children: "Nombre del sitio" }), (0, jsx_runtime_1.jsx)("input", { id: "site-name", type: "text", value: name, onChange: (event) => setName(event.target.value), maxLength: 120, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-description", children: "Descripci\u00F3n (opcional)" }), (0, jsx_runtime_1.jsx)("textarea", { id: "site-description", value: description, onChange: (event) => setDescription(event.target.value), rows: 3, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid md:grid-cols-2 gap-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-province", children: "Provincia (opcional)" }), (0, jsx_runtime_1.jsx)("input", { id: "site-province", type: "text", value: province, onChange: (event) => setProvince(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-municipality", children: "Municipio (opcional)" }), (0, jsx_runtime_1.jsx)("input", { id: "site-municipality", type: "text", value: municipality, onChange: (event) => setMunicipality(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "grid md:grid-cols-3 gap-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-latitude", children: "Latitud (opcional)" }), (0, jsx_runtime_1.jsx)("input", { id: "site-latitude", type: "number", step: "any", value: latitude, onChange: (event) => setLatitude(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-longitude", children: "Longitud (opcional)" }), (0, jsx_runtime_1.jsx)("input", { id: "site-longitude", type: "number", step: "any", value: longitude, onChange: (event) => setLongitude(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-gps-accuracy", children: "Precisi\u00F3n GPS (m)" }), (0, jsx_runtime_1.jsx)("input", { id: "site-gps-accuracy", type: "number", min: 0, step: "any", value: gpsAccuracyM, onChange: (event) => setGpsAccuracyM(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-radius", children: "Radio de an\u00E1lisis" }), (0, jsx_runtime_1.jsx)("select", { id: "site-radius", value: radiusM, onChange: (event) => setRadiusM(Number(event.target.value)), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }, children: radiusOptions.map((option) => ((0, jsx_runtime_1.jsx)("option", { value: option.value, children: option.label }, option.value))) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-notes", children: "Notas (opcional)" }), (0, jsx_runtime_1.jsx)("textarea", { id: "site-notes", value: notes, onChange: (event) => setNotes(event.target.value), rows: 3, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsx)("button", { type: "submit", disabled: submitting, className: "px-4 py-2 rounded border", style: { background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }, children: submitting ? "Guardando sitio..." : "Guardar sitio" })] }), error ? ((0, jsx_runtime_1.jsx)("div", { className: "mt-4 rounded px-4 py-3", style: { background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }, children: error })) : null, successMessage ? ((0, jsx_runtime_1.jsx)("div", { className: "mt-4 rounded px-4 py-3", style: { background: "#D1E7DD", color: "#0F5132", border: "1px solid #BADBCC" }, children: successMessage })) : null] })) : null, selectedProject ? ((0, jsx_runtime_1.jsxs)("section", { className: "p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Sitios del proyecto" }), loadingSites ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: "Cargando sitios..." })) : sites.length === 0 ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: "A\u00FAn no hay sitios para este proyecto. Crea uno para comenzar." })) : ((0, jsx_runtime_1.jsx)("div", { className: "space-y-4", children: sites.map((site) => ((0, jsx_runtime_1.jsxs)("article", { className: "p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col md:flex-row md:justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-semibold", style: { color: "var(--ld-text)" }, children: site.name }), (0, jsx_runtime_1.jsx)("p", { className: "text-sm mt-1", style: { color: "var(--ld-text-secondary)" }, children: selectedProject.name })] }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs uppercase", style: { color: "var(--ld-text-secondary)" }, children: new Date(site.createdAt).toLocaleDateString("es-DO", {
                                                year: "numeric",
                                                month: "short",
                                                day: "numeric",
                                            }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 grid gap-2 sm:grid-cols-2", children: [site.province || site.municipality ? ((0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: [site.province ? `Provincia: ${site.province}` : "", site.province && site.municipality ? ", " : "", site.municipality ? `Municipio: ${site.municipality}` : ""] })) : null, site.latitude != null && site.longitude != null ? ((0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: ["Coordenadas: ", site.latitude.toFixed(6), ", ", site.longitude.toFixed(6)] })) : null, (0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: ["Origen: ", site.locationSource] }), (0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: ["Radio: ", site.radiusM, " m"] }), (0, jsx_runtime_1.jsx)("a", { href: `/sampling-events?projectId=${selectedProject.id}&siteId=${site.id}`, className: "text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "Gestionar jornadas" })] })] }, site.id))) }))] })) : null] }));
}
