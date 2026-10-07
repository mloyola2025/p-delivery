"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type CourierAccount = {
  id: string;
  username: string;
  full_name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type EditState = {
  id: string;
  username: string;
  fullName: string;
  password: string;
};

async function apiRequest(method: string, body?: Record<string, unknown>) {
  const response = await fetch("/api/couriers", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    users?: CourierAccount[];
  };
  if (!response.ok) throw new Error(result.error ?? "No se pudo completar la acción.");
  return result;
}

export default function CourierUsersAdmin() {
  const [users, setUsers] = useState<CourierAccount[]>([]);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const result = await apiRequest("GET");
      setUsers(result.users ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las cuentas.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  function clearMessages() {
    setNotice("");
    setError("");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setBusy(true);
    try {
      await apiRequest("POST", { fullName, username, password });
      setFullName("");
      setUsername("");
      setPassword("");
      setNotice("Motorizado creado correctamente.");
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    clearMessages();
    setBusy(true);
    try {
      await apiRequest("PATCH", {
        id: editing.id,
        fullName: editing.fullName,
        username: editing.username,
        ...(editing.password ? { password: editing.password } : {}),
      });
      setEditing(null);
      setNotice("Datos del motorizado actualizados.");
      await loadUsers();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "No se pudo editar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: CourierAccount) {
    clearMessages();
    const nextActive = !user.active;
    if (
      !nextActive &&
      !window.confirm(`¿Dar de baja a ${user.full_name}? Perderá el acceso inmediatamente.`)
    )
      return;
    setBusy(true);
    try {
      await apiRequest("PATCH", { id: user.id, active: nextActive });
      setNotice(nextActive ? "Cuenta reactivada." : "Motorizado dado de baja.");
      await loadUsers();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No se pudo cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: CourierAccount) {
    clearMessages();
    if (
      !window.confirm(
        `¿Eliminar permanentemente a ${user.full_name} (${user.username})? El historial operativo ya registrado se conservará.`,
      )
    )
      return;
    setBusy(true);
    try {
      await apiRequest("DELETE", { id: user.id });
      if (editing?.id === user.id) setEditing(null);
      setNotice("Cuenta eliminada permanentemente.");
      await loadUsers();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-title courier-users-title">
        <div>
          <span className="eyebrow">SUPERADMIN · ACCESOS</span>
          <h1>Usuarios motorizados</h1>
          <p>Crea, modifica, da de baja o elimina las cuentas del equipo de reparto.</p>
        </div>
      </div>
      <section className="courier-user-create panel">
        <div>
          <h2>Crear motorizado</h2>
          <p>La cuenta funcionará en cualquier dispositivo y conservará su sesión.</p>
        </div>
        <form onSubmit={createUser}>
          <label>
            <span>Nombre completo</span>
            <input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Ej. Luis García" />
          </label>
          <label>
            <span>Usuario</span>
            <input required autoCapitalize="none" autoCorrect="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Ej. luis.garcia" />
          </label>
          <label>
            <span>Contraseña inicial</span>
            <input required type="password" maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Escribe una contraseña" />
          </label>
          <button className="primary" type="submit" disabled={busy}>＋ Crear usuario</button>
        </form>
      </section>
      {notice && <div className="management-message success courier-user-message">✓ {notice}</div>}
      {error && <div className="management-message error courier-user-message">{error}</div>}
      <section className="courier-users-list panel">
        <div className="courier-users-list-head">
          <div>
            <h2>Cuentas registradas</h2>
            <p>{users.length} motorizado{users.length === 1 ? "" : "s"}</p>
          </div>
          <button className="secondary" type="button" onClick={() => void loadUsers()}>Actualizar</button>
        </div>
        {users.length ? (
          <div className="courier-user-rows">
            {users.map((user) => (
              <article className={user.active ? "" : "is-disabled"} key={user.id}>
                {editing?.id === user.id ? (
                  <form className="courier-user-edit-form" onSubmit={saveEdit}>
                    <label><span>Nombre</span><input required value={editing.fullName} onChange={(event) => setEditing({ ...editing, fullName: event.target.value })} /></label>
                    <label><span>Usuario</span><input required value={editing.username} onChange={(event) => setEditing({ ...editing, username: event.target.value })} /></label>
                    <label><span>Nueva contraseña</span><input type="password" maxLength={128} autoComplete="new-password" value={editing.password} onChange={(event) => setEditing({ ...editing, password: event.target.value })} placeholder="Déjala vacía para conservarla" /></label>
                    <div><button className="courier-user-save" type="submit" disabled={busy}>Guardar</button><button className="courier-user-cancel" type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
                  </form>
                ) : (
                  <>
                    <div className="courier-user-avatar">{user.full_name.slice(0, 1).toUpperCase()}</div>
                    <div className="courier-user-info">
                      <strong>{user.full_name}</strong>
                      <span>@{user.username}</span>
                      <small>Creado {new Date(user.created_at).toLocaleDateString("es-PE")}</small>
                    </div>
                    <span className={user.active ? "courier-account-status active" : "courier-account-status"}>{user.active ? "Activo" : "De baja"}</span>
                    <div className="courier-user-actions">
                      <button className="courier-user-edit" type="button" onClick={() => setEditing({ id: user.id, username: user.username, fullName: user.full_name, password: "" })}>Editar</button>
                      <button className={user.active ? "courier-user-disable" : "courier-user-enable"} type="button" disabled={busy} onClick={() => void toggleUser(user)}>{user.active ? "Dar de baja" : "Reactivar"}</button>
                      <button className="courier-user-delete" type="button" disabled={busy} onClick={() => void deleteUser(user)}>Eliminar</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="courier-users-empty"><span>🛵</span><strong>Aún no hay motorizados</strong><p>Crea la primera cuenta usando el formulario superior.</p></div>
        )}
      </section>
    </>
  );
}
