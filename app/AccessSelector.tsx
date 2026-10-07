"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "./BrandLogo";

export default function AccessSelector() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const result = await response.json() as { error?: string; redirectTo?: string; role?: "superadmin" | "suyai" | "aura" };
      if (!response.ok || !result.redirectTo) {
        setError(result.error ?? "No se pudo iniciar sesión.");
        return;
      }
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      let safeReturnTo = result.redirectTo;
      if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        const target = new URL(returnTo, window.location.origin);
        const requestedAccess = target.searchParams.get("access");
        if (
          target.pathname.startsWith("/admin") &&
          (result.role === "superadmin" || requestedAccess === result.role)
        ) safeReturnTo = returnTo;
      }
      window.location.assign(safeReturnTo);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="access-page selector-page selector-superadmin unified-admin-access">
    <header className="access-header"><Link className="brand-lockup" href="/" aria-label="P-delivery"><BrandLogo priority /><span><strong>P-Delivery</strong><small>Suyai + Aura</small></span></Link><span className="system-status"><i /> Sistema operativo</span></header>
    <section className="selector-shell portal-selector-shell">
      <div className="selector-copy"><span className="eyebrow">ACCESO ADMINISTRATIVO</span><h1>Ingresa a tu administración</h1><p>Escribe tu usuario y contraseña. El sistema reconocerá automáticamente los permisos de Superadmin, Suyai o Aura.</p></div>
      <div className="portal-access-grid admin-only">
        <form className="access-selector-card admin-portal-card" onSubmit={login}>
          <div className="portal-card-heading"><BrandLogo brand="general" className="selected-access-icon" /><div><span>PORTAL DE ADMINISTRACIÓN</span><h2>Acceso seguro</h2></div></div>
          <p className="unified-admin-note">Tu cuenta abrirá directamente el panel y las funciones que le corresponden.</p>
          <div className="admin-login-fields"><label htmlFor="admin-username"><span>Usuario</span><input id="admin-username" required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="Ingresa tu usuario" /></label><label htmlFor="admin-password"><span>Contraseña</span><input id="admin-password" required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Ingresa tu contraseña" /></label></div>
          {error && <div className="admin-login-error" role="alert">{error}</div>}
          <button className="selector-submit" type="submit" disabled={submitting}>{submitting ? "Validando…" : "Ingresar a Administración"}<b>→</b></button>
          <small className="password-note">Acceso protegido.</small>
        </form>
      </div>
    </section>
    <footer className="access-footer"><span>Operación Lima · Almacén Rímac</span><span>Accesos independientes · Protegidos con contraseña</span></footer>
  </main>;
}
