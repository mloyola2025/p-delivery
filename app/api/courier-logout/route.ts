import { NextResponse } from "next/server";
import { COURIER_SESSION_COOKIE } from "../../courierAuth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COURIER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
