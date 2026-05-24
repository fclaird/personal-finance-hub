const STORAGE_KEY = "fh_api_key";

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string): void {
  sessionStorage.setItem(STORAGE_KEY, key.trim());
}

export function clearStoredApiKey(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** fetch wrapper that attaches the LAN API key when stored in sessionStorage. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const key = getStoredApiKey();
  const headers = new Headers(init?.headers);
  if (key && !headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${key}`);
  }
  return fetch(input, { ...init, headers });
}
