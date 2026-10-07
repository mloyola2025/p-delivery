"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deviceRegistration,
  getDevice,
  syncPushSubscription,
  unlinkPushDevice,
  type PushAudience,
} from "./pushClient";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  target_url: string;
  priority: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationCenter({
  audience,
  onLogout,
}: {
  audience: PushAudience;
  onLogout?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [notifications, device] = await Promise.all([
        fetch(`/api/notifications?audience=${audience}`, { cache: "no-store" }).then(
          (response) => response.json(),
        ),
        deviceRegistration(audience),
      ]);
      setItems(notifications.notifications ?? []);
      setUnread(notifications.unread ?? 0);
      setDiagnostic(device);
    } catch {}
  }, [audience]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load();
      if ("Notification" in window && Notification.permission === "granted")
        void syncPushSubscription(audience).then(() => load()).catch(() => undefined);
    }, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [audience, load]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (
        centerRef.current &&
        event.target instanceof Node &&
        !centerRef.current.contains(event.target)
      )
        setOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  async function activate() {
    setBusy(true);
    setNotice("");
    try {
      const result = await syncPushSubscription(audience, true);
      setNotice(
        result.ok
          ? "Notificaciones activadas en este dispositivo."
          : result.reason === "denied"
            ? "El permiso está bloqueado en el navegador."
            : result.reason === "not-configured"
              ? "Firebase aún no está configurado en producción."
              : "Este dispositivo no admite notificaciones web.",
      );
      await load();
    } catch {
      setNotice("No se pudo activar el dispositivo.");
    } finally {
      setBusy(false);
    }
  }

  async function testNotification() {
    setBusy(true);
    const response = await fetch("/api/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audience, deviceId: getDevice().id }),
    });
    const result = (await response.json()) as { error?: string };
    setNotice(response.ok ? "Notificación de prueba enviada." : result.error ?? "No se pudo enviar.");
    setBusy(false);
    await load();
  }

  async function unlink() {
    if (!window.confirm("¿Desvincular las notificaciones de este dispositivo?")) return;
    await unlinkPushDevice(audience);
    setNotice("Dispositivo desvinculado.");
    await load();
  }

  async function unlinkAndLogout() {
    if (!window.confirm("¿Cerrar sesión y desactivar las notificaciones en este dispositivo?")) return;
    await unlinkPushDevice(audience);
    await onLogout?.();
  }

  async function openNotification(item: NotificationItem) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audience, action: "read", id: item.id }),
    });
    window.location.assign(item.target_url);
  }

  async function markAllRead() {
    if (!unread || markingAll) return;
    setMarkingAll(true);
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })),
    );
    setUnread(0);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience, action: "read-all" }),
      });
      if (!response.ok) throw new Error("No se pudieron marcar como leídas.");
    } catch {
      setNotice("No se pudieron marcar todas como leídas.");
      await load();
    } finally {
      setMarkingAll(false);
    }
  }

  const subscription = diagnostic?.subscription as
    | { active?: boolean; last_seen_at?: string; last_notification_sent_at?: string }
    | null
    | undefined;
  const info = diagnostic?.info as { platform?: string; browser?: string; standalone?: boolean; ios?: boolean; android?: boolean } | undefined;
  const device = diagnostic?.device as { lastSyncAt?: string; pwaVersion?: string } | undefined;

  return (
    <div className="notification-center" ref={centerRef}>
      <button
        className="notification-bell"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`}
      >
        <span className="notification-bell-icon" aria-hidden="true">🔔</span>
        {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
      </button>
      {open && (
        <aside className="notification-drawer">
          <header>
            <div><strong>Notificaciones</strong><small>Mensajes persistentes del sistema</small></div>
            <div className="notification-header-actions">
              <button
                className="notification-read-all"
                type="button"
                disabled={!unread || markingAll}
                onClick={() => void markAllRead()}
              >
                ✓ Leer todas
              </button>
              <button
                className="notification-close"
                type="button"
                aria-label="Cerrar notificaciones"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </header>
          <section className="notification-device-status">
            <div><span className={subscription?.active ? "online" : ""} /><b>{subscription?.active ? "Push activa" : "Push no activada"}</b></div>
            <small>{info?.platform ?? "Dispositivo"} · {info?.browser ?? "Navegador"} · {info?.standalone ? "PWA instalada" : "Web"}</small>
            <small>Permiso: {String(diagnostic?.permission ?? "consultando")} · Service worker: {diagnostic?.serviceWorker ? "activo" : "inactivo"}</small>
            <small>Firebase: {diagnostic?.firebaseConfigured ? "configurado" : "pendiente"} · PWA {device?.pwaVersion ?? "1.0.0"}</small>
            {info?.ios && !info.standalone && <p>En iPhone, instala P-delivery en la pantalla de inicio antes de activar las notificaciones.</p>}
            {diagnostic?.permission === "denied" && <p>Las notificaciones están bloqueadas. Actívalas desde la configuración del navegador o del teléfono.</p>}
            {notice && <p>{notice}</p>}
            <div className="notification-device-actions">
              <button type="button" onClick={activate} disabled={busy}>Activar / actualizar</button>
              <button type="button" onClick={testNotification} disabled={busy || !subscription?.active}>Enviar prueba</button>
              <button className="danger" type="button" onClick={unlink} disabled={!subscription?.active}>Desvincular</button>
              {onLogout && <button className="danger" type="button" onClick={unlinkAndLogout}>Cerrar sesión y desactivar</button>}
            </div>
          </section>
          <div className="notification-list">
            {items.length ? items.map((item) => (
              <button className={item.read_at ? "" : "unread"} type="button" key={item.id} onClick={() => openNotification(item)}>
                <span>{item.priority === "high" ? "Urgente" : "Aviso"}</span>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{new Date(item.created_at).toLocaleString("es-PE")}</small>
              </button>
            )) : <p className="notification-empty">No hay notificaciones.</p>}
          </div>
        </aside>
      )}
    </div>
  );
}
