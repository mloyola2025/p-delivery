import LogisticsApp from "../LogisticsApp";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COURIER_SESSION_COOKIE, readCourierSession } from "../courierAuth";

export default async function MotorizadoPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const params = await searchParams;
  const session = await readCourierSession(
    (await cookies()).get(COURIER_SESSION_COOKIE)?.value,
  );
  if (!session) {
    const target = `/motorizado${params.order ? `?order=${encodeURIComponent(params.order)}` : ""}`;
    redirect(`/acceso-motorizado?returnTo=${encodeURIComponent(target)}`);
  }
  return (
    <LogisticsApp
      initialCourier
      initialOrderId={params.order ?? ""}
      initialCourierId={session.id}
      initialCourierName={session.fullName}
    />
  );
}
