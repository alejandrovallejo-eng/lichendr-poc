"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import PageHeader from "@/components/PageHeader";
import { useGuidedResults } from "../four-view/use-guided-results";
import { GuidedProgress } from "../four-view/GuidedResults";
import { createTree, createTreeSample } from "@/modules/trees/client";
import {
  fetchJornadaContext,
  fetchJornadaTreesWithStatus,
  type JornadaContext,
  type JornadaTreeRow,
} from "@/modules/prepare-day/client";
import {
  suggestTreeCode,
  withPreservedContext,
} from "@/modules/prepare-day/logic";

interface Props {
  eventId: string;
}

function formatLocalDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-DO", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function JornadaWorkflow({ eventId }: Props) {
  const [context, setContext] = useState<JornadaContext | null>(null);
  const [treeRows, setTreeRows] = useState<JornadaTreeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [resultsRevision, setResultsRevision] = useState(0);
  const guided = useGuidedResults(eventId, resultsRevision);

  // Add-tree form state.
  const [showAddNewTree, setShowAddNewTree] = useState(false);
  const [newTreeCodeOverride, setNewTreeCodeOverride] = useState<string | null>(null);
  const [newTreeSpecies, setNewTreeSpecies] = useState("");
  const [newTreeNotes, setNewTreeNotes] = useState("");
  const [savingNewTree, setSavingNewTree] = useState(false);

  // Evaluate-existing-tree form state.
  const [showEvaluateExisting, setShowEvaluateExisting] = useState(false);
  const [existingTreeId, setExistingTreeId] = useState<string | undefined>(undefined);
  const [savingExisting, setSavingExisting] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const ctx = await fetchJornadaContext(eventId);
      if (!ctx) {
        setNotFound(true);
        setContext(null);
        setTreeRows([]);
        return;
      }
      setContext(ctx);
      const rows = await fetchJornadaTreesWithStatus(ctx.site.id, ctx.event.id);
      setTreeRows(rows);
      setResultsRevision(value => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la jornada.");
    }
  }, [eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await reload();
      if (!active) return;
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  const contextQuery = useMemo(() => {
    if (!context) return {};
    return {
      projectId: context.project.id,
      siteId: context.site.id,
      eventId: context.event.id,
    };
  }, [context]);

  const treesInJornada = useMemo(() => treeRows.filter((row) => row.sample != null), [treeRows]);
  const availableTrees = useMemo(() => treeRows.filter((row) => row.sample == null), [treeRows]);

  const suggestedNextCode = useMemo(() => suggestTreeCode(treeRows.map((row) => row.tree)), [treeRows]);
  const effectiveNewTreeCode = newTreeCodeOverride ?? suggestedNextCode;

  const handleAddNewTree = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || savingNewTree) return;
    if (!effectiveNewTreeCode.trim()) {
      setError("El código del árbol es obligatorio.");
      return;
    }
    setSavingNewTree(true);
    setError(null);

    const { tree, error: treeError } = await createTree({
      siteId: context.site.id,
      code: effectiveNewTreeCode.trim(),
      speciesName: newTreeSpecies.trim() || undefined,
      notes: newTreeNotes.trim() || undefined,
      locationSource: "unknown",
    });
    if (treeError || !tree) {
      const msg = (treeError ?? "").toLowerCase();
      setError(
        msg.includes("unique") || msg.includes("duplicate")
          ? "Ya existe un árbol con ese código en este sitio. Elige otro código."
          : "No se pudo registrar el árbol.",
      );
      setSavingNewTree(false);
      return;
    }

    // Link the tree to the jornada via a tree_sample.
    const { treeSample, error: sampleError } = await createTreeSample({
      siteId: context.site.id,
      samplingEventId: context.event.id,
      treeId: tree.id,
      substrateType: "tree_bark",
      trunkOrientation: "unknown",
      shadeLevel: "unknown",
      confidenceLevel: "unknown",
    });

    if (sampleError || !treeSample) {
      const msg = (sampleError ?? "").toLowerCase();
      if (msg.includes("unique") || msg.includes("duplicate")) {
        // The tree was created but a sample already exists — reload so the
        // user can see the current state without duplicating anything.
        await reload();
      } else {
        setError(
          "El árbol se registró pero no se pudo vincular a la jornada. Puedes reintentar desde \"Evaluar árbol existente\".",
        );
        await reload();
      }
      setSavingNewTree(false);
      return;
    }

    setShowAddNewTree(false);
    setNewTreeCodeOverride(null);
    setNewTreeSpecies("");
    setNewTreeNotes("");
    setSavingNewTree(false);
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const handleEvaluateExisting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || savingExisting || !existingTreeId) return;

    setSavingExisting(true);
    setError(null);

    const { treeSample, error: sampleError } = await createTreeSample({
      siteId: context.site.id,
      samplingEventId: context.event.id,
      treeId: existingTreeId,
      substrateType: "tree_bark",
      trunkOrientation: "unknown",
      shadeLevel: "unknown",
      confidenceLevel: "unknown",
    });

    if (sampleError || !treeSample) {
      const msg = (sampleError ?? "").toLowerCase();
      if (msg.includes("unique") || msg.includes("duplicate")) {
        setError("Este árbol ya está incluido en la jornada.");
      } else {
        setError("No se pudo añadir el árbol a la jornada.");
      }
      setSavingExisting(false);
      await reload();
      return;
    }

    setShowEvaluateExisting(false);
    setExistingTreeId(undefined);
    setSavingExisting(false);
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Árboles de esta jornada" />
        <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
          Cargando jornada…
        </p>
      </div>
    );
  }

  if (notFound || !context) {
    return (
      <div>
        <PageHeader title="Árboles de esta jornada" />
        <div
          role="alert"
          className="rounded px-4 py-3 text-sm"
          style={{ background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }}
        >
          No se encontró la jornada solicitada. Verifica el enlace o vuelve a{" "}
          <Link href="/preparar-jornada" className="underline">
            Preparar jornada
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Árboles de esta jornada"
        subtitle={`${context.project.name} · ${context.site.name} · ${formatLocalDate(context.event.sampledAt)}`}
      />

      <section
        className="mb-6 p-4 rounded border text-sm"
        style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)", color: "var(--ld-text-secondary)" }}
      >
        <p>
          Jornada <strong style={{ color: "var(--ld-text)" }}>{context.event.name}</strong>. Añade
          árboles nuevos o evalúa árboles existentes del sitio dentro de esta jornada. Un mismo árbol
          puede evaluarse en jornadas distintas sin perder su identidad.
        </p>
      </section>

      <section className="mb-6 space-y-3" aria-label="Resultados de esta jornada">
        {guided.error ? <p role="alert">{guided.error} <button className="underline" onClick={guided.retry}>Reintentar lectura</button></p>
          : guided.rows ? <GuidedProgress rows={guided.rows} /> : <p role="status">Consultando vistas guardadas…</p>}
        <Link href={withPreservedContext("/analysis", contextQuery)} className="inline-block rounded px-4 py-2 font-semibold text-white" style={{ background: "var(--ld-sidebar, #173D35)" }}>
          Ver resultados de esta jornada →
        </Link>
        <Link href={`/analysis?mode=ecology&eventId=${encodeURIComponent(context.event.id)}`} className="ml-3 inline-block rounded border px-4 py-2 font-semibold">
          Análisis de diversidad
        </Link>
        <p className="text-xs">Las cuatro vistas cuentan como un árbol. Estos resultados son descriptivos; no clasifican la calidad del aire.</p>
      </section>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded px-4 py-3 text-sm"
          style={{ background: "#F9DAD6", color: "#842029", border: "1px solid #F5C2C7" }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          type="button"
          onClick={() => {
            setShowAddNewTree((current) => !current);
            setShowEvaluateExisting(false);
          }}
          className="px-4 py-2 rounded border font-medium"
          style={{
            background: "var(--ld-sand)",
            color: "var(--ld-text)",
            borderColor: "var(--ld-border)",
          }}
        >
          {showAddNewTree ? "Cancelar" : "Añadir árbol nuevo"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowEvaluateExisting((current) => !current);
            setShowAddNewTree(false);
          }}
          disabled={availableTrees.length === 0}
          className="px-4 py-2 rounded border font-medium disabled:opacity-50"
          style={{
            background: "#fff",
            color: "var(--ld-text)",
            borderColor: "var(--ld-border)",
          }}
        >
          {showEvaluateExisting ? "Cancelar" : "Evaluar árbol existente"}
        </button>
        <Link
          href="/preparar-jornada"
          className="px-4 py-2 rounded border text-sm"
          style={{ color: "var(--ld-sidebar, #173D35)", borderColor: "var(--ld-border)", background: "#fff" }}
        >
          Cambiar de jornada
        </Link>
      </div>

      {showAddNewTree ? (
        <form
          onSubmit={handleAddNewTree}
          className="mb-6 p-4 rounded border space-y-3"
          style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}
        >
          <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>
            Nuevo árbol
          </h2>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="new-tree-code">
              Código del árbol
            </label>
            <input
              id="new-tree-code"
              type="text"
              value={effectiveNewTreeCode}
              onChange={(event) => setNewTreeCodeOverride(event.target.value)}
              required
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--ld-text-secondary)" }}>
              Sugerencia automática sin colisión. El identificador real del árbol es interno y se
              mantiene entre jornadas; el código es solo una etiqueta legible.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="new-tree-species">
              Especie (opcional)
            </label>
            <input
              id="new-tree-species"
              type="text"
              value={newTreeSpecies}
              onChange={(event) => setNewTreeSpecies(event.target.value)}
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="new-tree-notes">
              Notas (opcional)
            </label>
            <textarea
              id="new-tree-notes"
              value={newTreeNotes}
              onChange={(event) => setNewTreeNotes(event.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            />
          </div>
          <button
            type="submit"
            disabled={savingNewTree}
            className="px-4 py-2 rounded border font-medium"
            style={{
              background: "var(--ld-sand)",
              color: "var(--ld-text)",
              borderColor: "var(--ld-border)",
            }}
          >
            {savingNewTree ? "Guardando…" : "Guardar y continuar"}
          </button>
        </form>
      ) : null}

      {showEvaluateExisting ? (
        <form
          onSubmit={handleEvaluateExisting}
          className="mb-6 p-4 rounded border space-y-3"
          style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}
        >
          <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>
            Evaluar árbol existente
          </h2>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="existing-tree-select">
              Árbol
            </label>
            <select
              id="existing-tree-select"
              value={existingTreeId ?? ""}
              onChange={(event) => setExistingTreeId(event.target.value || undefined)}
              required
              className="w-full px-3 py-2 rounded border"
              style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
            >
              <option value="">Selecciona un árbol del sitio</option>
              {availableTrees.map((row) => (
                <option key={row.tree.id} value={row.tree.id}>
                  {row.tree.code}
                  {row.tree.speciesName ? ` · ${row.tree.speciesName}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: "var(--ld-text-secondary)" }}>
              Al añadirlo a esta jornada mantiene su identidad; su historial anterior no se pierde ni
              se duplica.
            </p>
          </div>
          <button
            type="submit"
            disabled={savingExisting || !existingTreeId}
            className="px-4 py-2 rounded border font-medium"
            style={{
              background: "var(--ld-sand)",
              color: "var(--ld-text)",
              borderColor: "var(--ld-border)",
            }}
          >
            {savingExisting ? "Guardando…" : "Añadir a la jornada"}
          </button>
        </form>
      ) : null}

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold" style={{ color: "var(--ld-text)" }}>
            Árboles vinculados a esta jornada
          </h2>
          <span className="text-xs" style={{ color: "var(--ld-text-secondary)" }}>
            {refreshing ? "Actualizando…" : `${treesInJornada.length} árbol(es)`}
          </span>
        </div>

        {treesInJornada.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
            Todavía no hay árboles en esta jornada. Empieza por &quot;Añadir árbol nuevo&quot; o
            &quot;Evaluar árbol existente&quot;.
          </p>
        ) : (
          <ul className="space-y-3">
            {treesInJornada.map((row) => {
              const perTreeCtx = { ...contextQuery, treeSampleId: row.sample?.id };
              return (
                <li
                  key={row.tree.id}
                  className="rounded border p-4"
                  style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="font-semibold" style={{ color: "var(--ld-text)" }}>
                        {row.tree.code}
                      </h3>
                      <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>
                        {row.tree.speciesName ?? "Especie no identificada"}
                      </p>
                    </div>
                    <span
                      className="inline-flex items-center gap-2 rounded px-3 py-1 text-xs font-medium"
                      style={{ background: "#E4F1E9", color: "#17533C", border: "1px solid #C8DECF" }}
                    >
                      {guided.error ? "Guardado no disponible" : guided.rows ? `${guided.rows.find(result => result.sampleId === row.sample?.id)?.savedCount ?? 0}/4 vistas guardadas` : "Consultando guardado…"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={withPreservedContext("/images?mode=summary", perTreeCtx)}
                      className="inline-flex items-center rounded border px-3 py-2 text-sm font-semibold"
                      style={{ borderColor: "var(--ld-sidebar, #173D35)", background: "var(--ld-sidebar, #173D35)", color: "#fff" }}
                    >
                      Ver análisis del árbol
                    </Link>
                    <Link
                      href={withPreservedContext("/images", perTreeCtx)}
                      className="inline-flex items-center rounded border px-3 py-2 text-sm"
                      style={{
                        borderColor: "var(--ld-border)",
                        background: "var(--ld-sand)",
                        color: "var(--ld-text)",
                      }}
                    >
                      Captura 4 vistas
                    </Link>
                    <Link
                      href={withPreservedContext("/images/advanced", perTreeCtx)}
                      className="inline-flex items-center rounded border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    >
                      Carga avanzada
                    </Link>
                    <Link
                      href={withPreservedContext("/annotations", perTreeCtx)}
                      className="inline-flex items-center rounded border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--ld-border)", background: "#fff", color: "var(--ld-text)" }}
                    >
                      Anotaciones
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
