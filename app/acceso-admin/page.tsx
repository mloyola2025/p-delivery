import AccessSelector from "../AccessSelector";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "../adminAuth";

export default async function AdminAccessPage() {
  const session = await readAdminSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  if (session) redirect(`/admin?access=${session.role}`);
  return <AccessSelector />;
}
