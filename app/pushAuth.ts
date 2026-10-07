import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  readAdminSession,
  type AdminRole,
} from "./adminAuth";
import type { NotificationAudience } from "../lib/notificationService";
import {
  COURIER_SESSION_COOKIE,
  readCourierSession,
} from "./courierAuth";

export async function requireCourierUser() {
  return readCourierSession(
    (await cookies()).get(COURIER_SESSION_COOKIE)?.value,
  );
}

export async function authorizeAudience(requested?: string) {
  if (requested === "courier")
    return (await requireCourierUser()) ? ("courier" as const) : null;
  if (!requested || !["suyai", "aura"].includes(requested)) return null;
  const session = await readAdminSession(
    (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (!session) return null;
  if (session.role !== "superadmin" && session.role !== requested) return null;
  return requested as NotificationAudience;
}

export async function requireAdminRole(role?: AdminRole) {
  const session = await readAdminSession(
    (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (!session) return null;
  if (role && session.role !== role) return null;
  return session;
}

export async function requireOperator() {
  const [admin, courier] = await Promise.all([
    requireAdminRole(),
    requireCourierUser(),
  ]);
  return admin ? { type: "admin" as const, user: admin } : courier
    ? { type: "courier" as const, user: courier }
    : null;
}
