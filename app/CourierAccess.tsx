"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { BrandLogo } from "./BrandLogo";

export default function CourierAccess() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/courier-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };
      if (!response.ok || !result.redirectTo) {
        setError(result.error ?? "No se pudo iniciar sesión.");
        return;
      }
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const safeReturnTo =
        returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : result.redirectTo;
      window.location.assign(safeReturnTo);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="courier-login-page">
      <header>
        <Link href="/" aria-label="P-delivery">
          <BrandLogo priority />
          <span>
            <strong>P-Delivery</strong>
            <small>Suyai + Aura</small>
          </span>
        </Link>
      </header>
      <form className="courier-login-card" onSubmit={login}>
        <div className="courier-login-icon" aria-hidden="true">🛵</div>
        <span className="eyebrow">ACCESO DEL MOTORIZADO</span>
        <h1>Ingresa a tus entregas</h1>
        <p>Usa el usuario y contraseña asignados por el Superadmin.</p>
        <label>
          <span>Usuario</span>
          <input
            required
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Tu usuario"
          />
        </label>
        <label>
          <span>Contraseña</span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Tu contraseña"
          />
        </label>
        {error && <div className="admin-login-error" role="alert">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Validando…" : "Ingresar"}
          <b>→</b>
        </button>
        <small>La sesión permanecerá abierta hasta que pulses “Cerrar sesión”.</small>
      </form>
    </main>
  );
}
