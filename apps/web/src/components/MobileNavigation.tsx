"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import navigation, { isNavActive } from "@/config/navigation";
import NavIcon from "./NavIcon";
export default function MobileNavigation() {
  const pathname = usePathname();
  return (
    <details className="ld-mobile-nav" key={pathname}>
      <summary>
        <span>
          <NavIcon name="folder" /> Explorar LichenDR
        </span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <nav aria-label="Navegación móvil">
        {navigation.map((item) => {
          const active = isNavActive(pathname, item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={`ld-mobile-link${active ? " is-active" : ""}`}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </details>
  );
}
