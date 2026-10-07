"use client";

import { createClientId } from "./clientId";

export type PushAudience = "courier" | "suyai" | "aura";

const DEVICE_KEY = "p-delivery-device-v1";

type StoredDevice = {
  id: string;
  installedAt: string;
  lastSyncAt?: string;
  token?: string;
  pwaVersion: string;
};

export function getDevice() {
  const stored = localStorage.getItem(DEVICE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as StoredDevice;
    } catch {}
  }
  const device: StoredDevice = {
    id: createClientId(),
    installedAt: new Date().toISOString(),
    pwaVersion: "1.0.0",
  };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  return device;
}

function deviceInfo() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const browser = /Edg/i.test(ua)
    ? "Edge"
    : /CriOS|Chrome/i.test(ua)
      ? "Chrome"
      : /Safari/i.test(ua)
        ? "Safari"
        : /Firefox/i.test(ua)
          ? "Firefox"
          : "Navegador web";
  const platform = ios ? "iOS" : android ? "Android" : "Desktop";
  return {
    platform,
    browser,
    deviceName: `${standalone ? "PWA" : browser} en ${platform}`,
    userAgent: ua,
    standalone,
    ios,
    android,
  };
}

async function firebaseContext() {
  const response = await fetch("/api/push/config", { cache: "no-store" });
  const settings = (await response.json()) as {
    configured: boolean;
    config: Record<string, string>;
    vapidKey: string;
  };
  if (!settings.configured) return null;
  const [{ initializeApp, getApps }, messagingModule] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await messagingModule.isSupported())) return null;
  const app = getApps()[0] ?? initializeApp(settings.config);
  const registration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js",
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  return {
    messaging: messagingModule.getMessaging(app),
    messagingModule,
    registration,
    vapidKey: settings.vapidKey,
  };
}

export async function syncPushSubscription(
  audience: PushAudience,
  askPermission = false,
) {
  const device = getDevice();
  const info = deviceInfo();
  if (!("Notification" in window) || !("serviceWorker" in navigator))
    return { ok: false, reason: "unsupported", device, info };
  let permission = Notification.permission;
  if (askPermission && permission === "default")
    permission = await Notification.requestPermission();
  if (permission !== "granted")
    return { ok: false, reason: permission, device, info };
  const firebase = await firebaseContext();
  if (!firebase)
    return { ok: false, reason: "not-configured", device, info };
  const currentResponse = await fetch(
    `/api/push/subscriptions?audience=${audience}&deviceId=${encodeURIComponent(device.id)}`,
    { cache: "no-store" },
  );
  const current = currentResponse.ok
    ? ((await currentResponse.json()) as {
        subscription?: { active?: boolean; invalidation_reason?: string | null } | null;
      }).subscription
    : null;
  const refreshToken =
    askPermission ||
    Boolean(
      current &&
        current.active === false &&
        current.invalidation_reason &&
        current.invalidation_reason !== "user-unlinked",
    );
  if (refreshToken) {
    try {
      await firebase.messagingModule.deleteToken(firebase.messaging);
    } catch {}
  }
  const token = await firebase.messagingModule.getToken(firebase.messaging, {
    vapidKey: firebase.vapidKey,
    serviceWorkerRegistration: firebase.registration,
  });
  if (!token) return { ok: false, reason: "no-token", device, info };
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audience,
      deviceId: device.id,
      token,
      platform: info.platform,
      browser: info.browser,
      deviceName: info.deviceName,
      userAgent: info.userAgent,
      permissionStatus: permission,
    }),
  });
  if (!response.ok) throw new Error("No se pudo registrar el dispositivo.");
  const next = {
    ...device,
    token,
    lastSyncAt: new Date().toISOString(),
  };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(next));
  return { ok: true, device: next, info, serviceWorker: true };
}

export async function unlinkPushDevice(audience: PushAudience) {
  const device = getDevice();
  await fetch("/api/push/subscriptions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audience, deviceId: device.id }),
  });
  try {
    const firebase = await firebaseContext();
    if (firebase)
      await firebase.messagingModule.deleteToken(firebase.messaging);
  } catch {}
  const next = { ...device, token: undefined, lastSyncAt: new Date().toISOString() };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(next));
}

export async function deviceRegistration(audience: PushAudience) {
  const device = getDevice();
  const [response, configResponse] = await Promise.all([
    fetch(
      `/api/push/subscriptions?audience=${audience}&deviceId=${encodeURIComponent(device.id)}`,
      { cache: "no-store" },
    ),
    fetch("/api/push/config", { cache: "no-store" }),
  ]);
  const data = response.ok
    ? ((await response.json()) as { subscription?: Record<string, unknown> | null })
    : { subscription: null };
  return {
    device,
    info: deviceInfo(),
    permission: "Notification" in window ? Notification.permission : "unsupported",
    serviceWorker: "serviceWorker" in navigator && Boolean(await navigator.serviceWorker.getRegistration("/")),
    subscription: data.subscription ?? null,
    firebaseConfigured: configResponse.ok
      ? Boolean(((await configResponse.json()) as { configured?: boolean }).configured)
      : false,
  };
}
