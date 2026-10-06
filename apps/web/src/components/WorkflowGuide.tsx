"use client";
import { usePathname } from "next/navigation";
const stages = ["Preparar", "Capturar", "Revisar", "Interpretar"];
export default function WorkflowGuide() {
  const path = usePathname();
  const stage = path.startsWith("/images")
    ? 1
    : path.startsWith("/annotations")
      ? 2
      : ["/analysis", "/environmental-quality", "/exports"].some((prefix) =>
            path.startsWith(prefix),
          )
        ? 3
        : 0;
  if (path === "/" || path === "/cuenta" || path === "/vision-lab") return null;
  return (
    <aside
      className="ld-workflow-guide"
      aria-label="Etapas del trabajo de campo"
    >
      <span className="ld-workflow-caption">Tu recorrido</span>
      <ol>
        {stages.map((label, index) => (
          <li
            key={label}
            aria-current={index === stage ? "step" : undefined}
            className={index === stage ? "is-current" : ""}
          >
            <span className="ld-step-index" aria-hidden="true">
              {index + 1}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
