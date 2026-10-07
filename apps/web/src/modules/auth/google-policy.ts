export type AccountUser = { id: string; is_anonymous?: boolean; email?: string; identities?: { provider: string }[] };
export function googleReturnPath(value: unknown): "/demo" | "/compartidos" | null {
  return value === "/demo" || value === "/compartidos" ? value : null;
}

export function googleAction(user: AccountUser | null, action: string, projectCount: number | null) {
  if (user && !user.is_anonymous) return "connected";
  if (!user) return "signin";
  if (action !== "recover") return "link";
  // Never abandon an anonymous account containing saved work, even if the UI is stale.
  return projectCount === 0 ? "signin" : "protect";
}

export function linkedUserMatches(expectedId: string, user: AccountUser | null) {
  return !!user && !user.is_anonymous && !!user.email &&
    user.identities?.some(identity => identity.provider === "google") === true &&
    (expectedId === "signin" || user.id === expectedId);
}

export function authMessage(code: string | null) {
  switch (code) {
    case "connected": return "Google quedó conectado. Puedes recuperar tus proyectos entrando con esta misma cuenta.";
    case "cancelled": return "No se completó la conexión. Tu sesión anterior sigue disponible; puedes intentarlo otra vez.";
    case "protect": return "Hay proyectos en esta sesión. Vincula Google para conservarlos; no cambiaremos de usuario ni moveremos tus datos automáticamente.";
    case "conflict": return "Esa cuenta de Google ya está vinculada a otro usuario. Conservamos tu sesión actual. No se han unido ni movido proyectos.";
    case "expired": return "La conexión venció o se abrió en otro navegador. Vuelve a iniciarla desde aquí.";
    case "failed": return "No pudimos completar la conexión. Conservamos tu sesión anterior. Inténtalo de nuevo; si persiste, solicita ayuda.";
    default: return null;
  }
}
