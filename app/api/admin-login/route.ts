import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  createAdminSession,
  identifyAdminAccount,
} from "../../adminAuth";
import {
  clearLoginFailures,
  loginIsBlocked,
  recordLoginFailure,
} from "../../loginSecurity";
import { bodyTooLarge, rejectCrossSiteMutation } from "../../requestSecurity";

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    if (bodyTooLarge(request, 8_192))
      return NextResponse.json({ error: "Solicitud invÃ¡lida." }, { status: 413 });
    const limit = await loginIsBlocked(request, "admin-login");
    if (limit.blocked)
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta nuevamente en 15 minutos." },
        { status: 429, headers: { "retry-after": "900" } },
      );
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const account = await identifyAdminAccount(
      body.username ?? "",
      body.password ?? "",
    );
    if (!account) {
      await recordLoginFailure(limit.key);
      await new Promise((resolve) => setTimeout(resolve, 350));
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos." },
        { status: 401 },
      );
    }
    await clearLoginFailures(limit.key);
    const role = account.role;
    const response = NextResponse.json({
      ok: true,
      role,
      redirectTo: `/admin?access=${role}`,
    });
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      await createAdminSession(role, account.accountId),
      {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ADMIN_SESSION_SECONDS,
      },
    );
    return response;
  } catch (error) {
    console.error("admin-login", error);
    return NextResponse.json(
      { error: "No se pudo iniciar sesión." },
      { status: 500 },
    );
  }
}
