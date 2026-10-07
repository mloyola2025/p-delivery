import { NextResponse } from "next/server";

export function rejectCrossSiteMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site")
    return NextResponse.json({ error: "Solicitud no autorizada." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json({ error: "Solicitud no autorizada." }, { status: 403 });
  return null;
}

export function bodyTooLarge(request: Request, maximumBytes: number) {
  const length = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(length) && length > maximumBytes;
}
