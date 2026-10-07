import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CourierAccess from "../CourierAccess";
import { COURIER_SESSION_COOKIE, readCourierSession } from "../courierAuth";

export default async function CourierAccessPage() {
  const session = await readCourierSession(
    (await cookies()).get(COURIER_SESSION_COOKIE)?.value,
  );
  if (session) redirect("/motorizado");
  return <CourierAccess />;
}
