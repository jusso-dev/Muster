export const dynamic = "force-dynamic";
export function GET() {
  return new Response(
    [
      "# HELP muster_web_up Muster web process availability",
      "# TYPE muster_web_up gauge",
      "muster_web_up 1",
      "# HELP muster_sse_connections Active SSE connections (replica-local)",
      "# TYPE muster_sse_connections gauge",
      "muster_sse_connections 0",
      "",
    ].join("\n"),
    { headers: { "content-type": "text/plain; version=0.0.4" } },
  );
}
