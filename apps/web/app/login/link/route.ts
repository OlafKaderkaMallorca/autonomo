import { NextResponse, type NextRequest } from "next/server";
import { SITZUNGS_COOKIE } from "@/lib/api";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Anmeldelink aus der E-Mail einlösen, Sitzungs-Cookie setzen und weiterleiten. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const basis = process.env.WEB_URL ?? req.nextUrl.origin;
  const res = await fetch(`${API_URL}/auth/magic-link/einloesen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.redirect(new URL("/login?fehler=link", basis));
  const { token: sitzung } = (await res.json()) as { token: string };
  const antwort = NextResponse.redirect(new URL("/", basis));
  antwort.cookies.set(SITZUNGS_COOKIE, sitzung, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return antwort;
}
