const target = process.env.MUSTER_HEALTHCHECK_URL;

if (!target) {
  process.stderr.write("MUSTER_HEALTHCHECK_URL is required\n");
  process.exit(1);
}

try {
  const response = await fetch(target, { signal: AbortSignal.timeout(4_000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
