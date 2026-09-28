"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = SamplingEventsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const PageHeader_1 = __importDefault(require("@/components/PageHeader"));
const client_1 = require("@/modules/projects/client");
const client_2 = require("@/modules/sites/client");
const client_3 = require("@/modules/sampling-events/client");
exports.dynamic = "force-dynamic";
const statusOptions = [
    { value: "draft", label: "Borrador" },
    { value: "completed", label: "Completada" },
];
function formatLocalDateTime(value) {
    try {
        return new Date(value).toLocaleString("es-DO", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch {
        return value;
    }
}
function getLocalDatetimeLocalValue(date) {
    const tzOffset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - tzOffset * 60000);
    return localDate.toISOString().slice(0, 16);
}
function SamplingEventsPage() {
    const [projects, setProjects] = (0, react_1.useState)([]);
    const [sites, setSites] = (0, react_1.useState)([]);
    const [samplingEvents, setSamplingEvents] = (0, react_1.useState)([]);
    const [selectedProjectId, setSelectedProjectId] = (0, react_1.useState)(undefined);
    const [selectedSiteId, setSelectedSiteId] = (0, react_1.useState)(undefined);
    const [loadingProjects, setLoadingProjects] = (0, react_1.useState)(false);
    const [loadingSites, setLoadingSites] = (0, react_1.useState)(false);
    const [loadingEvents, setLoadingEvents] = (0, react_1.useState)(false);
    const [submitting, setSubmitting] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [successMessage, setSuccessMessage] = (0, react_1.useState)(null);
    const [eventName, setEventName] = (0, react_1.useState)("");
    const [sampledAt, setSampledAt] = (0, react_1.useState)(getLocalDatetimeLocalValue(new Date()));
    const [observerNames, setObserverNames] = (0, react_1.useState)("");
    const [weatherNotes, setWeatherNotes] = (0, react_1.useState)("");
    const [status, setStatus] = (0, react_1.useState)("draft");
    const [notes, setNotes] = (0, react_1.useState)("");
    const selectedProject = (0, react_1.useMemo)(() => projects.find((project) => project.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
    const selectedSite = (0, react_1.useMemo)(() => sites.find((site) => site.id === selectedSiteId) ?? null, [sites, selectedSiteId]);
    (0, react_1.useEffect)(() => {
        async function loadProjects() {
            setLoadingProjects(true);
            setError(null);
            const { projects: loadedProjects, error: projectsError } = await (0, client_1.fetchProjects)();
            if (projectsError) {
                setError(projectsError);
                setProjects([]);
                setLoadingProjects(false);
                return;
            }
            setProjects(loadedProjects);
            const searchParams = new URLSearchParams(window.location.search);
            const projectId = searchParams.get("projectId") ?? undefined;
            const siteId = searchParams.get("siteId") ?? undefined;
            const projectIsValid = projectId && loadedProjects.some((project) => project.id === projectId);
            setSelectedProjectId(projectIsValid ? projectId : loadedProjects[0]?.id);
            setSelectedSiteId(siteId);
            setLoadingProjects(false);
        }
        loadProjects();
    }, []);
    (0, react_1.useEffect)(() => {
        async function syncSites() {
            if (!selectedProjectId) {
                setSites([]);
                setSelectedSiteId(undefined);
                return;
            }
            setLoadingSites(true);
            setError(null);
            const { sites: loadedSites, error: sitesError } = await (0, client_2.fetchSitesByProject)(selectedProjectId);
            if (sitesError) {
                setError(sitesError);
                setSites([]);
                setSelectedSiteId(undefined);
                setLoadingSites(false);
                return;
            }
            setSites(loadedSites);
            const searchParams = new URLSearchParams(window.location.search);
            const siteId = searchParams.get("siteId") ?? undefined;
            const siteIsValid = siteId && loadedSites.some((site) => site.id === siteId);
            setSelectedSiteId(siteIsValid ? siteId : loadedSites[0]?.id);
            setLoadingSites(false);
        }
        syncSites();
    }, [selectedProjectId]);
    (0, react_1.useEffect)(() => {
        async function syncEvents() {
            if (!selectedSiteId) {
                setSamplingEvents([]);
                return;
            }
            setLoadingEvents(true);
            setError(null);
            const { samplingEvents: loadedEvents, error: eventsError } = await (0, client_3.fetchSamplingEventsBySite)(selectedSiteId);
            if (eventsError) {
                setError(eventsError);
                setSamplingEvents([]);
                setLoadingEvents(false);
                return;
            }
            setSamplingEvents(loadedEvents);
            setLoadingEvents(false);
        }
        syncEvents();
    }, [selectedSiteId]);
    const validateForm = () => {
        if (!selectedProjectId) {
            return "Selecciona un proyecto.";
        }
        if (!selectedSiteId) {
            return "Selecciona un sitio.";
        }
        if (!eventName.trim()) {
            return "El nombre de la jornada es obligatorio.";
        }
        if (eventName.trim().length > 120) {
            return "El nombre no puede tener más de 120 caracteres.";
        }
        if (!sampledAt) {
            return "La fecha y hora del muestreo son obligatorias.";
        }
        const dateValue = new Date(sampledAt);
        if (Number.isNaN(dateValue.getTime())) {
            return "La fecha y hora del muestreo no es válida.";
        }
        if (!["draft", "completed"].includes(status)) {
            return "El estado de la jornada no es válido.";
        }
        return null;
    };
    const localSampledAtToISO = (localValue) => {
        const localDate = new Date(localValue);
        const timezoneOffsetMs = localDate.getTimezoneOffset() * 60000;
        return new Date(localDate.getTime() - timezoneOffsetMs).toISOString();
    };
    const handleCreate = async (event) => {
        event.preventDefault();
        setError(null);
        setSuccessMessage(null);
        const validationError = validateForm();
        if (validationError) {
            setError(validationError);
            return;
        }
        if (!selectedSiteId) {
            setError("Selecciona un sitio.");
            return;
        }
        setSubmitting(true);
        const sampledAtIso = localSampledAtToISO(sampledAt);
        const { samplingEvent, error: createError } = await (0, client_3.createSamplingEvent)({
            siteId: selectedSiteId,
            name: eventName.trim(),
            sampledAt: sampledAtIso,
            observerNames: observerNames.trim() || undefined,
            weatherNotes: weatherNotes.trim() || undefined,
            protocolVersion: "poc-v1",
            status,
            notes: notes.trim() || undefined,
        });
        if (createError) {
            if (createError.toLowerCase().includes("unique") || createError.toLowerCase().includes("duplicate")) {
                setError("Ya existe una jornada con ese nombre en este sitio.");
            }
            else {
                setError("No se pudo crear la jornada. Intenta de nuevo.");
            }
            setSubmitting(false);
            return;
        }
        if (samplingEvent) {
            setSamplingEvents((current) => [samplingEvent, ...current]);
            setEventName("");
            setSampledAt(getLocalDatetimeLocalValue(new Date()));
            setObserverNames("");
            setWeatherNotes("");
            setStatus("draft");
            setNotes("");
            setSuccessMessage("Jornada guardada correctamente.");
        }
        setSubmitting(false);
    };
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)(PageHeader_1.default, { title: "Jornadas de muestreo", subtitle: "Administra jornadas de muestreo dentro de tus sitios y proyectos." }), (0, jsx_runtime_1.jsx)("section", { className: "mb-6", style: { color: "var(--ld-text-secondary)" }, children: (0, jsx_runtime_1.jsx)("p", { className: "text-sm", children: "La jerarqu\u00EDa es Proyecto \u2192 Sitio \u2192 Jornada. Selecciona un proyecto y un sitio para crear jornadas de muestreo." }) }), loadingProjects ? ((0, jsx_runtime_1.jsx)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "var(--ld-card)", border: "1px solid var(--ld-border)" }, children: "Cargando proyectos..." })) : projects.length === 0 ? ((0, jsx_runtime_1.jsxs)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "var(--ld-card)", border: "1px solid var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("p", { children: "Primero debes crear un proyecto." }), (0, jsx_runtime_1.jsx)("a", { href: "/projects", className: "text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "Ir a proyectos" })] })) : ((0, jsx_runtime_1.jsx)("section", { className: "mb-6 p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: (0, jsx_runtime_1.jsxs)("div", { className: "grid gap-4 md:grid-cols-2", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "project-select", children: "Proyecto" }), (0, jsx_runtime_1.jsxs)("select", { id: "project-select", value: selectedProjectId ?? "", onChange: (event) => setSelectedProjectId(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Selecciona un proyecto" }), projects.map((project) => ((0, jsx_runtime_1.jsx)("option", { value: project.id, children: project.name }, project.id)))] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "site-select", children: "Sitio" }), (0, jsx_runtime_1.jsxs)("select", { id: "site-select", value: selectedSiteId ?? "", onChange: (event) => setSelectedSiteId(event.target.value), disabled: sites.length === 0, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: "Selecciona un sitio" }), sites.map((site) => ((0, jsx_runtime_1.jsx)("option", { value: site.id, children: site.name }, site.id)))] })] })] }) })), selectedProjectId && sites.length === 0 && !loadingSites ? ((0, jsx_runtime_1.jsxs)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "var(--ld-card)", border: "1px solid var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("p", { children: "Este proyecto todav\u00EDa no tiene sitios." }), (0, jsx_runtime_1.jsx)("a", { href: `/sites?projectId=${selectedProjectId}`, className: "text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "Gestionar sitios" })] })) : null, selectedProjectId && sites.length > 0 ? ((0, jsx_runtime_1.jsxs)("section", { className: "mb-6 p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Nueva jornada" }), (0, jsx_runtime_1.jsxs)("form", { onSubmit: handleCreate, className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "event-name", children: "Nombre de la jornada" }), (0, jsx_runtime_1.jsx)("input", { id: "event-name", type: "text", value: eventName, onChange: (event) => setEventName(event.target.value), maxLength: 120, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "sampled-at", children: "Fecha y hora del muestreo" }), (0, jsx_runtime_1.jsx)("input", { id: "sampled-at", type: "datetime-local", value: sampledAt, onChange: (event) => setSampledAt(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "observer-names", children: "Observadores (opcional)" }), (0, jsx_runtime_1.jsx)("input", { id: "observer-names", type: "text", value: observerNames, onChange: (event) => setObserverNames(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "weather-notes", children: "Condiciones meteorol\u00F3gicas (opcional)" }), (0, jsx_runtime_1.jsx)("textarea", { id: "weather-notes", value: weatherNotes, onChange: (event) => setWeatherNotes(event.target.value), rows: 3, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "status", children: "Estado" }), (0, jsx_runtime_1.jsx)("select", { id: "status", value: status, onChange: (event) => setStatus(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }, children: statusOptions.map((option) => ((0, jsx_runtime_1.jsx)("option", { value: option.value, children: option.label }, option.value))) })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "protocol-version", children: "Versi\u00F3n del protocolo" }), (0, jsx_runtime_1.jsx)("div", { className: "px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#f8f9fa", color: "var(--ld-text)" }, children: "poc-v1" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "notes", children: "Notas (opcional)" }), (0, jsx_runtime_1.jsx)("textarea", { id: "notes", value: notes, onChange: (event) => setNotes(event.target.value), rows: 3, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsx)("button", { type: "submit", disabled: submitting, className: "px-4 py-2 rounded border", style: { background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }, children: submitting ? "Guardando jornada..." : "Guardar jornada" })] }), error ? ((0, jsx_runtime_1.jsx)("div", { className: "mt-4 rounded px-4 py-3", style: { background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }, children: error })) : null, successMessage ? ((0, jsx_runtime_1.jsx)("div", { className: "mt-4 rounded px-4 py-3", style: { background: "#D1E7DD", color: "#0F5132", border: "1px solid #BADBCC" }, children: successMessage })) : null] })) : null, selectedProjectId && selectedSiteId ? ((0, jsx_runtime_1.jsxs)("section", { className: "p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Jornadas de muestreo" }), loadingEvents ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: "Cargando jornadas..." })) : samplingEvents.length === 0 ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: "No hay jornadas registradas para este sitio." })) : ((0, jsx_runtime_1.jsx)("div", { className: "space-y-4", children: samplingEvents.map((event) => ((0, jsx_runtime_1.jsxs)("article", { className: "p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex flex-col md:flex-row md:justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-semibold", style: { color: "var(--ld-text)" }, children: event.name }), (0, jsx_runtime_1.jsxs)("p", { className: "text-sm mt-1", style: { color: "var(--ld-text-secondary)" }, children: [selectedProject?.name, " / ", selectedSite?.name] })] }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs uppercase", style: { color: "var(--ld-text-secondary)" }, children: formatLocalDateTime(event.sampledAt) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 grid gap-3 sm:grid-cols-2", children: [event.observerNames ? ((0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: [(0, jsx_runtime_1.jsx)("strong", { children: "Observadores:" }), " ", event.observerNames] })) : null, event.weatherNotes ? ((0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: [(0, jsx_runtime_1.jsx)("strong", { children: "Condiciones:" }), " ", event.weatherNotes] })) : null, (0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: [(0, jsx_runtime_1.jsx)("strong", { children: "Estado:" }), " ", event.status === "draft" ? "Borrador" : "Completada"] }), (0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: [(0, jsx_runtime_1.jsx)("strong", { children: "Protocolo:" }), " ", event.protocolVersion] }), event.notes ? ((0, jsx_runtime_1.jsxs)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: [(0, jsx_runtime_1.jsx)("strong", { children: "Notas:" }), " ", event.notes] })) : null, (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 flex flex-wrap gap-3", children: [(0, jsx_runtime_1.jsx)("a", { href: `/jornada/${event.id}`, className: "text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "\u00C1rboles de esta jornada" }), (0, jsx_runtime_1.jsx)("a", { href: `/trees?projectId=${selectedProjectId}&siteId=${selectedSiteId}&eventId=${event.id}`, className: "text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "Vista cl\u00E1sica" })] })] })] }, event.id))) }))] })) : null] }));
}
