import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../lib/cloudDb";
import {
  COURIER_SESSION_COOKIE,
  COURIER_SESSION_SECONDS,
  createCourierSession,
  normalizeCourierUsername,
  verifyCourierPassword,
} from "../../courierAuth";
import {
  clearLoginFailures,
  loginIsBlocked,
  recordLoginFailure,
} from "../../loginSecurity";
import { bodyTooLarge, rejectCrossSiteMutation } from "../../requestSecurity";

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    if (bodyTooLarge(request, 8_192))
      return NextResponse.json({ error: "Solicitud invÃ¡lida." }, { status: 413 });
    const limit = await loginIsBlocked(request, "courier-login");
    if (limit.blocked)
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta nuevamente en 15 minutos." },
        { status: 429, headers: { "retry-after": "900" } },
      );
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = normalizeCourierUsername(body.username ?? "");
    await ensureCloudSchema();
    const sql = getCloudDb();
    const rows = await sql<
      { id: string; password_hash: string; active: boolean }[]
    >`
      select id, password_hash, active from courier_users
      where lower(username) = ${username} limit 1
    `;
    const account = rows[0];
    const valid = Boolean(
      account?.active &&
        body.password &&
        (await verifyCourierPassword(body.password, account.password_hash)),
    );
    if (!valid) {
      await recordLoginFailure(limit.key);
      await new Promise((resolve) => setTimeout(resolve, 400));
      console.warn(JSON.stringify({
        level: "warning",
        message: "courier-login-rejected",
        durationMs: Date.now() - startedAt,
      }));
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos, o cuenta inactiva." },
        { status: 401 },
      );
    }
    await clearLoginFailures(limit.key);
    const response = NextResponse.json({ ok: true, redirectTo: "/motorizado" });
    response.cookies.set(
      COURIER_SESSION_COOKIE,
      await createCourierSession(account.id),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: COURIER_SESSION_SECONDS,
      },
    );
    console.info(JSON.stringify({
      level: "info",
      message: "courier-login-complete",
      durationMs: Date.now() - startedAt,
    }));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "courier-login-failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return NextResponse.json(
      { error: "No se pudo iniciar sesión." },
      { status: 500 },
    );
  }
}
