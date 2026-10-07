import type { AdminAccess } from "../../../LogisticsApp";
import NewOrderForm from "./NewOrderForm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, canAccessAdmin, readAdminSession } from "../../../adminAuth";

export default async function NuevoPedidoPage({ searchParams }: { searchParams: Promise<{ access?: string; edit?: string }> }) {
  const params = await searchParams;
  const access: AdminAccess = params.access === "suyai" || params.access === "aura" ? params.access : "superadmin";
  const session = await readAdminSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (!session || !canAccessAdmin(session.role, access)) redirect("/acceso-admin");
  const editOrderId =
    typeof params.edit === "string" && /^[a-zA-Z0-9_-]{3,64}$/.test(params.edit)
      ? params.edit
      : "";
  return <NewOrderForm initialAccess={access} editOrderId={editOrderId} />;
}
