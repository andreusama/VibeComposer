// A cold launch can stall a Supabase request with no error (waking WiFi/
// cellular radio, DNS, or a silent token refresh riding along on the first
// request) — fetch() has no built-in timeout, so an unlucky first request
// just hangs forever and the caller's loading spinner never resolves. A
// page refresh "fixes" it only because the connection/token is warm by
// then. Race against a hard timeout instead so callers always get a
// settled result to show (and retry) rather than an infinite spinner.
export const DEFAULT_LOAD_TIMEOUT_MS = 12000;

export function withTimeout(promise, ms = DEFAULT_LOAD_TIMEOUT_MS, message = "Couldn't reach the server — check your connection and try again.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
