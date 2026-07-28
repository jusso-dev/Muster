export interface CloseableServer {
  close(callback: (error?: Error) => void): unknown;
}

/**
 * `server.close()` is asynchronous: it stops accepting new connections but
 * existing keep-alive requests continue until it emits its completion
 * callback. Closing the database pool before that drain completes can tear
 * it down under an in-flight MCP tool call (including its audit write), on
 * every SIGTERM/rolling deploy. Await the callback first.
 */
export async function gracefulShutdown(
  server: CloseableServer,
  closeDb: () => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
}
