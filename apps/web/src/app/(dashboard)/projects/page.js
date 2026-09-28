"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ProjectsPage;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const PageHeader_1 = __importDefault(require("@/components/PageHeader"));
const client_1 = require("@/modules/projects/client");
function ProjectsPage() {
    const [projects, setProjects] = (0, react_1.useState)([]);
    const [name, setName] = (0, react_1.useState)("");
    const [description, setDescription] = (0, react_1.useState)("");
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [successMessage, setSuccessMessage] = (0, react_1.useState)(null);
    const loadProjects = async () => {
        setLoading(true);
        setError(null);
        const { projects: loadedProjects, error: fetchError } = await (0, client_1.fetchProjects)();
        if (fetchError) {
            setError(fetchError);
            setProjects([]);
        }
        else {
            setProjects(loadedProjects);
        }
        setLoading(false);
    };
    (0, react_1.useEffect)(() => {
        async function initialize() {
            await loadProjects();
        }
        initialize();
    }, []);
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setSuccessMessage(null);
        if (!name.trim()) {
            setError("El nombre del proyecto es obligatorio.");
            return;
        }
        setLoading(true);
        const { project, error: createError } = await (0, client_1.createProject)(name, description);
        if (createError) {
            setError(createError);
        }
        else if (project) {
            setProjects((current) => [project, ...current]);
            setName("");
            setDescription("");
            setSuccessMessage("Proyecto creado correctamente.");
        }
        setLoading(false);
    };
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)(PageHeader_1.default, { title: "Proyectos", subtitle: "Crea y administra tus proyectos de monitoreo de l\u00EDquenes." }), (0, jsx_runtime_1.jsx)("section", { className: "mb-6", style: { color: "var(--ld-text-secondary)" }, children: (0, jsx_runtime_1.jsx)("p", { className: "text-sm", children: "Crea un proyecto para comenzar con el flujo de sitios, jornadas y \u00E1rboles." }) }), (0, jsx_runtime_1.jsxs)("section", { className: "mb-6 p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Nuevo proyecto" }), (0, jsx_runtime_1.jsxs)("form", { onSubmit: handleSubmit, className: "space-y-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "project-name", children: "Nombre" }), (0, jsx_runtime_1.jsx)("input", { id: "project-name", type: "text", value: name, onChange: (event) => setName(event.target.value), className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("label", { className: "block text-sm font-medium mb-1", style: { color: "var(--ld-text)" }, htmlFor: "project-description", children: "Descripci\u00F3n (opcional)" }), (0, jsx_runtime_1.jsx)("textarea", { id: "project-description", value: description, onChange: (event) => setDescription(event.target.value), rows: 3, className: "w-full px-3 py-2 rounded border", style: { borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" } })] }), (0, jsx_runtime_1.jsx)("button", { type: "submit", disabled: loading, className: "px-4 py-2 rounded border", style: { background: "var(--ld-sand)", color: "var(--ld-text)", borderColor: "var(--ld-border)" }, children: loading ? "Guardando..." : "Crear proyecto" })] })] }), error ? ((0, jsx_runtime_1.jsx)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }, children: error })) : null, successMessage ? ((0, jsx_runtime_1.jsx)("div", { className: "mb-6 rounded px-4 py-3", style: { background: "#D1E7DD", color: "#0F5132", border: "1px solid #BADBCC" }, children: successMessage })) : null, (0, jsx_runtime_1.jsxs)("section", { children: [(0, jsx_runtime_1.jsx)("h2", { className: "font-semibold mb-3", style: { color: "var(--ld-text)" }, children: "Proyectos existentes" }), loading && projects.length === 0 ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: "Cargando proyectos..." })) : projects.length === 0 ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm", style: { color: "var(--ld-text-secondary)" }, children: "No hay proyectos. Crea uno para empezar." })) : ((0, jsx_runtime_1.jsx)("div", { className: "space-y-3", children: projects.map((project) => ((0, jsx_runtime_1.jsx)("article", { className: "p-4 rounded border", style: { background: "var(--ld-card)", borderColor: "var(--ld-border)" }, children: (0, jsx_runtime_1.jsxs)("div", { className: "flex justify-between items-start gap-4", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { className: "font-semibold", style: { color: "var(--ld-text)" }, children: project.name }), project.description ? ((0, jsx_runtime_1.jsx)("p", { className: "text-sm mt-1", style: { color: "var(--ld-text-secondary)" }, children: project.description })) : null, (0, jsx_runtime_1.jsx)("a", { href: `/sites?projectId=${project.id}`, className: "inline-block mt-3 text-sm font-medium", style: { color: "var(--ld-primary)" }, children: "Gestionar sitios" })] }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs uppercase", style: { color: "var(--ld-text-secondary)" }, children: new Date(project.createdAt).toLocaleDateString("es-DO", {
                                            year: "numeric",
                                            month: "short",
                                            day: "numeric",
                                        }) })] }) }, project.id))) }))] })] }));
}
