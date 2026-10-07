"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type ManagedAdminRole = "suyai" | "aura";

type AdminAccount = {
  id: string;
  username: string;
  full_name: string;
  role: ManagedAdminRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type EditState = {
  id: string;
  username: string;
  fullName: string;
  role: ManagedAdminRole;
  password: string;
};

async function apiRequest(method: string, body?: Record<string, unknown>) {
  const response = await fetch("/api/admin-users", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    users?: AdminAccount[];
  };
  if (!response.ok)
    throw new Error(result.error ?? "No se pudo completar la acción.");
  return result;
}

function roleLabel(role: ManagedAdminRole) {
  return role === "suyai" ? "Administración Suyai" : "Administración Aura";
}

export default function AdminUsersAdmin() {
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<ManagedAdminRole>("suyai");
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
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las cuentas.",
      );
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
      await apiRequest("POST", { fullName, username, role, password });
      setFullName("");
      setUsername("");
      setPassword("");
      setNotice(`Administrador de ${role === "suyai" ? "Suyai" : "Aura"} creado correctamente.`);
      await loadUsers();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "No se pudo crear la cuenta.",
      );
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
        role: editing.role,
        ...(editing.password ? { password: editing.password } : {}),
      });
      setEditing(null);
      setNotice("Administrador actualizado correctamente.");
      await loadUsers();
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "No se pudo editar la cuenta.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: AdminAccount) {
    clearMessages();
    const nextActive = !user.active;
    if (
      !nextActive &&
      !window.confirm(
        `¿Dar de baja a ${user.full_name}? Perderá el acceso administrativo inmediatamente.`,
      )
    )
      return;
    setBusy(true);
    try {
      await apiRequest("PATCH", { id: user.id, active: nextActive });
      setNotice(
        nextActive ? "Cuenta reactivada." : "Administrador dado de baja.",
      );
      await loadUsers();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "No se pudo cambiar el estado.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: AdminAccount) {
    clearMessages();
    if (
      !window.confirm(
        `¿Eliminar permanentemente a ${user.full_name} (${user.username})? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setBusy(true);
    try {
      await apiRequest("DELETE", { id: user.id });
      if (editing?.id === user.id) setEditing(null);
      setNotice("Cuenta administrativa eliminada permanentemente.");
      await loadUsers();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo eliminar la cuenta.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-title courier-users-title">
        <div>
          <span className="eyebrow">SUPERADMIN · SEGURIDAD</span>
          <h1>Administradores Suyai y Aura</h1>
          <p>
            Crea y administra cuentas con acceso limitado exclusivamente a su
            empresa.
          </p>
        </div>
      </div>
      <section className="courier-user-create admin-user-create panel">
        <div>
          <h2>Crear administrador</h2>
          <p>
            La cuenta funcionará online en cualquier dispositivo y conservará
            su sesión hasta cerrar sesión o ser dada de baja.
          </p>
        </div>
        <form onSubmit={createUser}>
          <label>
            <span>Nombre completo</span>
            <input
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Ej. María López"
            />
          </label>
          <label>
            <span>Usuario</span>
            <input
              required
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Ej. maria.suyai"
            />
          </label>
          <label>
            <span>Rango</span>
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as ManagedAdminRole)
              }
            >
              <option value="suyai">Administración Suyai</option>
              <option value="aura">Administración Aura</option>
            </select>
          </label>
          <label>
            <span>Contraseña inicial</span>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={128}
              placeholder="Escribe una contraseña"
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            ＋ Crear administrador
          </button>
        </form>
      </section>
      {notice && (
        <div className="management-message success courier-user-message">
          ✓ {notice}
        </div>
      )}
      {error && (
        <div className="management-message error courier-user-message">
          {error}
        </div>
      )}
      <section className="courier-users-list panel">
        <div className="courier-users-list-head">
          <div>
            <h2>Cuentas adicionales</h2>
            <p>
              {users.length} administrador{users.length === 1 ? "" : "es"}
            </p>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() => void loadUsers()}
          >
            Actualizar
          </button>
        </div>
        {users.length ? (
          <div className="courier-user-rows admin-user-rows">
            {users.map((user) => (
              <article
                className={user.active ? "" : "is-disabled"}
                key={user.id}
              >
                {editing?.id === user.id ? (
                  <form
                    className="courier-user-edit-form admin-user-edit-form"
                    onSubmit={saveEdit}
                  >
                    <label>
                      <span>Nombre</span>
                      <input
                        required
                        value={editing.fullName}
                        onChange={(event) =>
                          setEditing({ ...editing, fullName: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Usuario</span>
                      <input
                        required
                        value={editing.username}
                        onChange={(event) =>
                          setEditing({ ...editing, username: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Rango</span>
                      <select
                        value={editing.role}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            role: event.target.value as ManagedAdminRole,
                          })
                        }
                      >
                        <option value="suyai">Suyai</option>
                        <option value="aura">Aura</option>
                      </select>
                    </label>
                    <label>
                      <span>Nueva contraseña</span>
                      <input
                        type="password"
                        maxLength={128}
                        autoComplete="new-password"
                        value={editing.password}
                        onChange={(event) =>
                          setEditing({ ...editing, password: event.target.value })
                        }
                        placeholder="Vacía para conservarla"
                      />
                    </label>
                    <div>
                      <button
                        className="courier-user-save"
                        type="submit"
                        disabled={busy}
                      >
                        Guardar
                      </button>
                      <button
                        className="courier-user-cancel"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className={`courier-user-avatar admin-${user.role}`}>
                      {user.full_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="courier-user-info">
                      <strong>{user.full_name}</strong>
                      <span>@{user.username}</span>
                      <small>
                        Creado {new Date(user.created_at).toLocaleDateString("es-PE")}
                      </small>
                    </div>
                    <span className={`admin-role-badge ${user.role}`}>
                      {roleLabel(user.role)}
                    </span>
                    <span
                      className={
                        user.active
                          ? "courier-account-status active"
                          : "courier-account-status"
                      }
                    >
                      {user.active ? "Activo" : "De baja"}
                    </span>
                    <div className="courier-user-actions">
                      <button
                        className="courier-user-edit"
                        type="button"
                        onClick={() =>
                          setEditing({
                            id: user.id,
                            username: user.username,
                            fullName: user.full_name,
                            role: user.role,
                            password: "",
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        className={
                          user.active
                            ? "courier-user-disable"
                            : "courier-user-enable"
                        }
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleUser(user)}
                      >
                        {user.active ? "Dar de baja" : "Reactivar"}
                      </button>
                      <button
                        className="courier-user-delete"
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteUser(user)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="courier-users-empty">
            <span>◆</span>
            <strong>Aún no hay administradores adicionales</strong>
            <p>Crea la primera cuenta usando el formulario superior.</p>
          </div>
        )}
      </section>
    </>
  );
}
