# P-delivery

Sistema logístico de Suyai y Aura desplegado en Next.js, Vercel y Supabase. Incluye pedidos, inventario, reportes Excel, panel móvil del motorizado y una arquitectura de notificaciones internas + Firebase Cloud Messaging.

## Ejecución local

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

Rutas principales:

- `/`: selección de portal.
- `/acceso-admin`: autenticación administrativa.
- `/admin`: administración Suyai, Aura o superadmin.
- `/motorizado`: control móvil de entregas.

## Arquitectura de notificaciones

El sistema separa la sesión del usuario del registro del dispositivo:

1. El navegador genera un `device_id` persistente local.
2. Firebase Web Messaging entrega el token FCM.
3. `/api/push/subscriptions` asocia el token a `suyai`, `aura` o `courier`.
4. `NotificationService` crea siempre la notificación interna en Supabase.
5. Si el grupo tiene push habilitada y Firebase está configurado, el servidor envía a todos sus dispositivos activos.
6. El service worker recibe mensajes con la PWA en segundo plano o cerrada.
7. Al pulsar la alerta abre el deep link interno; si el admin no tiene sesión, conserva `returnTo` durante el login.
8. Tokens inválidos quedan inactivos y la tarea diaria desactiva dispositivos obsoletos.

Las notificaciones push usan mensajes privados por defecto: no incluyen dirección, teléfono, productos, monto, fotos ni notas en la pantalla bloqueada.

### Eventos implementados

- Pedido nuevo: alerta al motorizado.
- Inicio de ruta: alerta al administrador de la empresa.
- Entregado, reprogramado, cancelado o devolución: alerta al administrador de la empresa.
- Notificación de prueba con límite de una por minuto.

El superadmin administra dispositivos y activa/desactiva los grupos, pero no recibe alertas comerciales propias.

## Configuración de Firebase

1. Crear una aplicación Web en Firebase.
2. Habilitar Firebase Cloud Messaging API.
3. Crear una clave Web Push/VAPID.
4. Crear una cuenta de servicio con permiso para FCM.
5. Copiar `.env.example` a `.env.local` y completar las variables.
6. Configurar las mismas variables en Vercel para Production y Preview.

Variables públicas permitidas en el navegador:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_VAPID_KEY
```

Variables privadas, solo servidor:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

La clave privada puede guardarse con saltos de línea escapados como `\n`. Nunca debe tener prefijo `NEXT_PUBLIC_`.

## Supabase y migraciones

```bash
npm run db:migrate:cloud
```

La migración `db/migrations/001_notifications.sql` crea:

- `push_subscriptions`
- `notifications`
- `notification_delivery_attempts`
- `notification_preferences`
- `notification_audit`

Las tablas están protegidas con RLS sin acceso para los roles `anon` y `authenticated`; solo las Route Handlers server-side usan la conexión PostgreSQL propietaria.

### Evidencias fotográficas

Las fotos nuevas se guardan en el bucket privado `order-evidence` de Supabase Storage, creado automáticamente por el servidor. Se requieren `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (o `SUPABASE_SECRET_KEY`). Las fotos antiguas que ya existan en Vercel Blob conservan lectura y borrado por compatibilidad.

La aplicación no ejecuta `put()`, `copy()` ni `list()` sobre Vercel Blob. Por tanto, las nuevas evidencias no generan **Blob Advanced Operations**; el acceso legado solo realiza lectura y `del()`.

## Uso en Android

1. Abrir P-delivery en Chrome.
2. Instalar la aplicación desde el menú de Chrome.
3. Abrir la campana y pulsar **Activar / actualizar**.
4. Aceptar el permiso del sistema.
5. Usar **Enviar prueba**.
6. Si Android bloquea alertas, revisar Ajustes → Aplicaciones → P-delivery/Chrome → Notificaciones y las restricciones de batería.

## Uso en iPhone

1. Abrir P-delivery en Safari.
2. Compartir → **Agregar a pantalla de inicio**.
3. Abrir la PWA instalada, no la pestaña de Safari.
4. Abrir la campana y pulsar **Activar / actualizar**.
5. Aceptar el permiso y enviar una prueba.

La interfaz detecta iPhone sin PWA instalada y muestra estas instrucciones únicamente en ese caso.

## Sesión y dispositivos

- **Cerrar sesión** mantiene el dispositivo registrado.
- **Cerrar sesión y desactivar** desvincula el token actual y después cierra la sesión.
- **Desvincular** desactiva las push del dispositivo sin cambiar la sesión.
- El superadmin puede revocar cualquier dispositivo desde Gestiones.

El acceso del motorizado continúa libre, como se definió para esta fase. Por ello sus equipos se registran bajo la audiencia compartida `courier`; cuando existan cuentas individuales se podrá migrar `user_id` sin cambiar la arquitectura.

## Validación

```bash
npm run lint
npm test
npm run build:vercel
```

Las pruebas cubren renderizado de portales, permisos por empresa, inventario, reportes, estructura de suscripciones, idempotencia, tokens inválidos, service worker, deep links y diagnóstico.
