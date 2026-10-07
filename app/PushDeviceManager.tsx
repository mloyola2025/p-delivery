"use client";

import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  user_id: string;
  device_name: string | null;
  platform: string | null;
  browser: string | null;
  permission_status: string;
  active: boolean;
  last_seen_at: string;
  last_notification_sent_at: string | null;
  invalidation_reason: string | null;
};

export function PushDeviceManager() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/push/devices", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { devices?: Device[] };
    setDevices(data.devices ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function revoke(device: Device) {
    if (!window.confirm(`¿Revocar ${device.device_name ?? "este dispositivo"}?`)) return;
    const response = await fetch("/api/push/devices", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: device.id }),
    });
    setNotice(response.ok ? "Dispositivo revocado." : "No se pudo revocar.");
    await load();
  }

  return (
    <section className="panel management-card push-device-manager">
      <div className="management-heading">
        <span>▣</span>
        <div>
          <h2>Dispositivos de notificación</h2>
          <p>Registro y auditoría de equipos vinculados a cada acceso.</p>
        </div>
      </div>
      {notice && <p className="management-message success">{notice}</p>}
      <div className="push-device-table">
        {devices.length ? devices.map((device) => (
          <article key={device.id}>
            <div>
              <span className={`device-state ${device.active ? "active" : ""}`} />
              <div>
                <strong>{device.device_name ?? "Dispositivo sin nombre"}</strong>
                <small>{device.user_id} · {device.platform ?? "Plataforma"} · {device.browser ?? "Navegador"}</small>
              </div>
            </div>
            <div className="device-dates">
              <small>Última actividad</small>
              <b>{new Date(device.last_seen_at).toLocaleString("es-PE")}</b>
              <small>{device.last_notification_sent_at ? `Última push: ${new Date(device.last_notification_sent_at).toLocaleString("es-PE")}` : "Sin push enviada"}</small>
            </div>
            <span className={device.active ? "status green" : "status cancelado"}>{device.active ? "Activo" : device.invalidation_reason ?? "Inactivo"}</span>
            <button type="button" onClick={() => revoke(device)} disabled={!device.active}>Revocar</button>
          </article>
        )) : <p className="clean-empty">Todavía no hay dispositivos registrados.</p>}
      </div>
    </section>
  );
}
