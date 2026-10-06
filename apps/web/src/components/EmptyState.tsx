import type { ReactNode } from "react";
import NavIcon from "./NavIcon";
import type { NavItem } from "@/config/navigation";
export default function EmptyState({
  title,
  children,
  icon = "folder",
  headingLevel = 3,
}: {
  title: string;
  children: ReactNode;
  icon?: NavItem["icon"];
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="ld-empty-state">
      <span className="ld-empty-icon">
        <NavIcon name={icon} />
      </span>
      <div>
        <Heading>{title}</Heading>
        <div className="ld-empty-description">{children}</div>
      </div>
    </div>
  );
}
