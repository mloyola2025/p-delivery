import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COURIER_SESSION_COOKIE, readCourierSession } from "../../courierAuth";

export async function GET() {
  const session = await readCourierSession(
    (await cookies()).get(COURIER_SESSION_COOKIE)?.value,
  );
  if (!session)
    return NextResponse.json({ error: "Sesión inactiva." }, { status: 401 });
  return NextResponse.json({ user: session });
}
