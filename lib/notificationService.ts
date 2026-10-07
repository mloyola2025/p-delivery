import type postgres from "postgres";
import { ensureCloudSchema, getCloudDb } from "./cloudDb";

export type NotificationAudience = "courier" | "suyai" | "aura";

export type NotificationEvent = {
  audience: NotificationAudience;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  targetUrl: string;
  priority?: "normal" | "high";
  businessId?: "suyai" | "aura";
  recipientAccountId?: string;
  idempotencyKey: string;
};

type SubscriptionRow = { id: string; token: string };

function internalTarget(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://p-delivery.local");
    return url.origin === "https://p-delivery.local"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}

async function firebaseMessaging() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  const [{ cert, getApps, initializeApp }, { getMessaging }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/messaging"),
  ]);
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  return getMessaging(app);
}

function permanentTokenError(code?: string) {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token" ||
    code === "messaging/invalid-argument"
  );
}

async function pushAllowed(audience: NotificationAudience) {
  const sql = getCloudDb();
  const settings = await sql<
    { value: { suyai?: boolean; aura?: boolean; courier?: boolean } }[]
  >`select value from app_settings where key = 'push-settings'`;
  return Boolean(settings[0]?.value?.[audience]);
}

export async function sendNotificationForEvent(event: NotificationEvent) {
  await ensureCloudSchema();
  const sql = getCloudDb();
  const notificationId = crypto.randomUUID();
  const targetUrl = internalTarget(event.targetUrl);
  const inserted = await sql<{ id: string }[]>`
    insert into notifications (
      id, user_id, account_id, business_id, type, title, message, entity_type,
      entity_id, target_url, priority, status, idempotency_key
    ) values (
      ${notificationId}, ${event.audience}, ${event.recipientAccountId ?? null},
      ${event.businessId ?? null},
      ${event.type}, ${event.title.slice(0, 120)}, ${event.message.slice(0, 280)},
      ${event.entityType ?? null}, ${event.entityId ?? null}, ${targetUrl},
      ${event.priority ?? "normal"}, 'created', ${event.idempotencyKey}
    ) on conflict (idempotency_key) do nothing returning id
  `;
  if (!inserted[0]) return { duplicate: true, sent: 0, failed: 0 };

  if (!(await pushAllowed(event.audience))) {
    await sql`update notifications set status = 'queued' where id = ${notificationId}`;
    return { duplicate: false, sent: 0, failed: 0, queued: true };
  }

  const subscriptions = await sql<SubscriptionRow[]>`
    select id, token from push_subscriptions
    where user_id = ${event.audience} and active = true
      and (${event.recipientAccountId ?? null}::text is null
        or account_id = ${event.recipientAccountId ?? null})
    order by last_seen_at desc
  `;
  const messaging = await firebaseMessaging();
  if (!messaging || !subscriptions.length) {
    await sql`update notifications set status = 'queued' where id = ${notificationId}`;
    return {
      duplicate: false,
      sent: 0,
      failed: 0,
      queued: true,
      firebaseConfigured: Boolean(messaging),
    };
  }

  let sent = 0;
  let failed = 0;
  for (let start = 0; start < subscriptions.length; start += 500) {
    const batch = subscriptions.slice(start, start + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: batch.map((subscription) => subscription.token),
      data: {
        notificationId,
        title: event.title.slice(0, 120),
        body: event.message.slice(0, 280),
        targetUrl,
        priority: event.priority ?? "normal",
        entityType: event.entityType ?? "",
        entityId: event.entityId ?? "",
      },
      webpush: {
        headers: { Urgency: event.priority === "high" ? "high" : "normal" },
        fcmOptions: { link: targetUrl },
      },
    });
    for (let index = 0; index < result.responses.length; index += 1) {
      const response = result.responses[index];
      const subscription = batch[index];
      const attemptId = crypto.randomUUID();
      const errorCode = response.error?.code;
      if (response.success) {
        sent += 1;
        await sql`
          update push_subscriptions
          set last_notification_sent_at = now(), updated_at = now()
          where id = ${subscription.id}
        `;
      } else {
        failed += 1;
        if (permanentTokenError(errorCode)) {
          await sql`
            update push_subscriptions set active = false, invalidated_at = now(),
              invalidation_reason = ${errorCode ?? "invalid-token"}, updated_at = now()
            where id = ${subscription.id}
          `;
        }
      }
      await sql`
        insert into notification_delivery_attempts (
          id, notification_id, push_subscription_id, provider, status,
          provider_message_id, error_code, error_message, sent_at
        ) values (
          ${attemptId}, ${notificationId}, ${subscription.id}, 'fcm',
          ${response.success ? "sent" : "failed"}, ${response.messageId ?? null},
          ${errorCode ?? null}, ${response.error?.message?.slice(0, 500) ?? null},
          ${response.success ? new Date() : null}
        )
      `;
    }
  }

  const status = sent && failed ? "partially_sent" : sent ? "sent" : "failed";
  await sql`
    update notifications set status = ${status},
      sent_at = case when ${sent} > 0 then now() else sent_at end
    where id = ${notificationId}
  `;
  await sql`
    insert into notification_audit (id, event, actor, entity_id, details)
    values (${crypto.randomUUID()}, 'notification.dispatched', 'server',
      ${event.entityId ?? null},
      ${sql.json({ notificationId, audience: event.audience, recipientAccountId: event.recipientAccountId ?? null, sent, failed } as postgres.JSONValue)})
  `;
  return { duplicate: false, sent, failed };
}

export async function pruneStaleSubscriptions() {
  await ensureCloudSchema();
  const sql = getCloudDb();
  const days = Math.max(7, Number(process.env.PUSH_STALE_DAYS) || 30);
  const rows = await sql<{ id: string }[]>`
    update push_subscriptions
    set active = false, invalidated_at = now(),
      invalidation_reason = 'stale-device', updated_at = now()
    where active = true and last_seen_at < now() - (${days} * interval '1 day')
    returning id
  `;
  return rows.length;
}
