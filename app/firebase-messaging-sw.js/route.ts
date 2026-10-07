function workerSource() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  return `
const FIREBASE_CONFIG = ${JSON.stringify(config)};
const CACHE_VERSION = "p-delivery-push-v1";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = typeof data.targetUrl === "string" && data.targetUrl.startsWith("/") && !data.targetUrl.startsWith("//") ? data.targetUrl : "/";
  if (data.notificationId) {
    event.waitUntil(fetch("/api/push/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId: data.notificationId })
    }).catch(() => undefined));
  }
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(targetUrl);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("p-delivery-push-") && key !== CACHE_VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js");

if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId) {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    return self.registration.showNotification(data.title || "P-delivery", {
      body: data.body || "Tienes una nueva actualización.",
      icon: "/brands/p-delivery.png",
      badge: "/brands/p-delivery.png",
      tag: data.notificationId || undefined,
      renotify: data.priority === "high",
      data: { notificationId: data.notificationId, targetUrl: data.targetUrl || "/" }
    });
  });
}
`;
}

export async function GET() {
  return new Response(workerSource(), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
    },
  });
}
