// Client-safe fetch helper. A failed request used to look like an empty account
// (`.catch(() => {})` → "No campaigns yet"), and a Vercel 504 HTML page made
// `res.json()` throw a bare SyntaxError. This always throws a readable Error —
// the server's own `error` message when it sent one — so pages can show a banner.

// `status` is 0 when the request never reached the server.
export class FetchError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function getJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new FetchError("Couldn’t reach the server — check your connection and try again. Nothing was lost.", 0);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  const serverError = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error : "";
  if (!res.ok) {
    throw new FetchError(serverError || `The server didn’t answer (HTTP ${res.status}) — reload to try again. Nothing was lost.`, res.status);
  }
  if (data === null && text) {
    throw new FetchError("The server sent back something unexpected — reload to try again. Nothing was lost.", res.status);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
