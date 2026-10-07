import LogisticsApp, { type AdminAccess } from "../LogisticsApp";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, canAccessAdmin, readAdminSession } from "../adminAuth";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ access?: string; order?: string; date?: string }> }) {
  const params = await searchParams;
  const access: AdminAccess = params.access === "suyai" || params.access === "aura" ? params.access : "superadmin";
  const initialDate =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : "";
  const session = await readAdminSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || !canAccessAdmin(session.role, access)) {
    const target = `/admin?access=${access}${params.order ? `&order=${encodeURIComponent(params.order)}` : ""}${initialDate ? `&date=${encodeURIComponent(initialDate)}` : ""}`;
    redirect(`/acceso-admin?returnTo=${encodeURIComponent(target)}`);
  }
  return <LogisticsApp initialAccess={access} initialOrderId={params.order ?? ""} initialDate={initialDate} />;
}
