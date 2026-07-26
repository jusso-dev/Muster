import { NextResponse, type NextRequest } from "next/server";

const publicPrefixes = [
  "/login",
  "/offline",
  "/api/auth",
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/metrics",
  "/muster-logo.png",
  "/sw.js",
  "/manifest.webmanifest",
];

export function proxy(request: NextRequest) {
  if (publicPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  const hasSession =
    request.cookies.has("muster.session_token") ||
    request.cookies.has("__Secure-muster.session_token");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
