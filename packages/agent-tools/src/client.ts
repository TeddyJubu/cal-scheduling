import { z } from "zod";

export interface ClientConfig {
  apiKey: string;
  baseUrl?: string;
  webUrl?: string;
}

export const apiVersions = {
  bookings: "2024-08-13",
  slots: "2024-09-04",
  "event-types": "2024-06-14",
  schedules: "2024-06-11",
  me: "2024-06-14",
  "community-events": "2024-06-14",
} as const;

export class CalClient {
  constructor(private readonly config: ClientConfig) {}

  withPublicEventUrl(response: unknown): unknown {
    if (!this.config.webUrl) return response;
    const parsed = z
      .object({
        data: z
          .object({ slug: z.string(), host: z.object({ username: z.string() }).passthrough() })
          .passthrough(),
      })
      .passthrough()
      .safeParse(response);
    if (!parsed.success) return response;
    const { slug, host } = parsed.data.data;
    return {
      ...parsed.data,
      data: {
        ...parsed.data.data,
        publicUrl: `${this.config.webUrl.replace(/\/+$/, "")}/events/${encodeURIComponent(host.username)}/${encodeURIComponent(slug)}`,
      },
    };
  }

  async request(
    resource: keyof typeof apiVersions,
    options: {
      path?: string;
      query?: Record<string, unknown>;
      body?: unknown;
      method?: "GET" | "POST" | "PATCH";
    } = {}
  ): Promise<unknown> {
    const base = (this.config.baseUrl ?? "https://api.cal.com").replace(/\/+$/, "");
    const url = new URL(`${base}/v2/${resource}${options.path ?? ""}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
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
