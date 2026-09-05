const VONAGE_API_KEY = process.env.VONAGE_API_KEY ?? "";
const VONAGE_API_SECRET = process.env.VONAGE_API_SECRET ?? "";

const BASE = "https://rest.nexmo.com";

export interface VonageNumber {
  msisdn: string;
  [key: string]: unknown;
}

function configured(): boolean {
  return Boolean(VONAGE_API_KEY && VONAGE_API_SECRET);
}

async function vonageFetch(
  path: string,
  method: "GET" | "POST" = "GET",
  params: Record<string, string> = {},
): Promise<unknown> {
  const qs = new URLSearchParams({
    api_key: VONAGE_API_KEY,
    api_secret: VONAGE_API_SECRET,
    ...params,
  });

  const url = method === "GET" ? `${BASE}${path}?${qs}` : `${BASE}${path}`;

  const opts: RequestInit =
    method === "POST"
      ? {
          method: "POST",
          body: qs,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      : { method: "GET" };

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vonage ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<unknown>;
}

export const vonageClient = {
  configured,

  async searchNumbers(country: string): Promise<VonageNumber[]> {
    if (!configured()) return [];
    const data = (await vonageFetch("/number/search", "GET", { country, features: "SMS" })) as {
      numbers?: VonageNumber[];
    };
    return data.numbers ?? [];
  },

  async rentNumber(country: string, msisdn: string): Promise<void> {
    if (!configured()) throw new Error("Vonage not configured");
    await vonageFetch("/number/buy", "POST", { country, msisdn });
  },

  async releaseNumber(country: string, msisdn: string): Promise<void> {
    if (!configured()) throw new Error("Vonage not configured");
    await vonageFetch("/number/cancel", "POST", { country, msisdn });
  },

  /**
   * Outbound SMS. Added for GF-20's dead-end auto-reply and used for nothing
   * else yet — see the DROP policy in routes/numbers.ts.
   *
   * Returns false instead of throwing when Vonage is unconfigured, because the
   * only caller is a best-effort courtesy reply on an inbound path that must
   * always answer the webhook 200. A send failure must never turn into a 500
   * that makes Vonage retry the whole delivery.
   */
  async sendSms(from: string, to: string, text: string): Promise<boolean> {
    if (!configured()) return false;
    await vonageFetch("/sms/json", "POST", { from, to, text });
    return true;
  },
};
