import { NextResponse, type NextRequest } from "next/server";

const publicPrefixes = [
  "/login",
  "/offline",
  "/api/auth",
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/metrics",
  "/icons/",
  "/sw.js",
  "/manifest.webmanifest",
];

export function proxy(request: NextRequest) {
  if (
    publicPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }
  const hasSession =
    request.cookies.has("muster.session_token") ||
    request.cookies.has("__Secure-muster.session_token");
  if (!hasSession) {
    if (request.nextUrl.pathname.startsWith("/api/v1/")) {
      return NextResponse.json(
        {
          type: "https://muster.security/problems/unauthorised",
          title: "Unauthorised",
          status: 401,
          detail: "Authentication is required.",
        },
        {
          status: 401,
          headers: { "content-type": "application/problem+json" },
        },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
