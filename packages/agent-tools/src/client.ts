export interface ClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export const apiVersions = {
  bookings: "2024-08-13",
  slots: "2024-09-04",
  "event-types": "2024-06-14",
  schedules: "2024-06-11",
  me: "2024-06-14",
} as const;

export class CalClient {
  constructor(private readonly config: ClientConfig) {}

  async request(
    resource: keyof typeof apiVersions,
    options: { path?: string; query?: Record<string, unknown>; body?: unknown } = {}
  ): Promise<unknown> {
    const base = (this.config.baseUrl ?? "https://api.cal.com").replace(/\/+$/, "");
    const url = new URL(`${base}/v2/${resource}${options.path ?? ""}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "cal-api-version": apiVersions[resource],
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const raw = await response.text();
    let data: unknown = raw;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      // Proxies may return non-JSON errors.
    }
    if (!response.ok) {
      throw new Error(
        `Cal API ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`
      );
    }
    return data;
  }
}
