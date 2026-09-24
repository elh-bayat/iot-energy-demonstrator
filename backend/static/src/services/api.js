/**
 * Minimal fetch wrapper (JSON in/out).
 */
export function createApi({ baseUrl = "" } = {}) {
  async function get(url) {
    const r = await fetch(baseUrl + url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }

  async function post(url, body) {
    const r = await fetch(baseUrl + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }

  return { get, post };
}
