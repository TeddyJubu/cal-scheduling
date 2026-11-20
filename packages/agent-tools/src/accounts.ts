import { z } from "zod";
import { CalClient } from "./client.js";
import type { AgentTool } from "./tools.js";
import { getTools } from "./tools.js";

const accountSchema = z.object({
  apiKey: z.string().min(1),
  apiUrl: z.string().url().optional(),
  webUrl: z.string().url().optional(),
});
export type AccountConfig = z.infer<typeof accountSchema>;
export type AccountTool = Omit<AgentTool, "handler"> & { handler: (input: unknown) => Promise<unknown> };
export class CalAccounts {
  private readonly clients = new Map<string, CalClient>();
  readonly defaultAccount: string;
  constructor(config: { accounts: Record<string, AccountConfig>; defaultAccount?: string }) {
    const parsed = z.record(accountSchema).safeParse(config.accounts);
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      throw new Error("Provide at least one valid Cal account");
    for (const [name, account] of Object.entries(parsed.data)) {
      if (!name) throw new Error("Account names cannot be empty");
      this.clients.set(
        name,
        new CalClient({ apiKey: account.apiKey, baseUrl: account.apiUrl, webUrl: account.webUrl })
      );
    }
    this.defaultAccount = config.defaultAccount ?? this.names[0];
    this.client();
  }
  get names(): [string, ...string[]] {
    return z
      .array(z.string())
      .nonempty()
      .parse([...this.clients.keys()]);
  }
  client(business = this.defaultAccount): CalClient {
    const client = this.clients.get(business);
    if (!client) throw new Error("Unknown Cal business account");
    return client;
  }
  getTools({ readOnly }: { readOnly?: boolean } = {}): AccountTool[] {
    const business = z
      .enum(this.names)
      .optional()
      .default(this.defaultAccount)
      .describe("Business account to use; defaults to the configured default or first account");
    const entries = getTools({ readOnly });
    if (this.names.length > 1)
      entries.push({
        name: "list_businesses",
        description:
          "List configured business account names only. Use to select the business for subsequent tools.",
        inputSchema: z.object({}),
        mutating: false,
        handler: async () => this.names,
      });
    return entries.map((entry) => {
      const inputSchema = this.names.length > 1 ? entry.inputSchema.extend({ business }) : entry.inputSchema;
      return {
        ...entry,
        inputSchema,
        handler: (input: unknown) => {
          const { business: selected, ...args } = inputSchema.parse(input);
          return entry.handler(args, this.client(selected));
        },
      };
    });
  }
}

export function clientFromEnv(env: Record<string, string | undefined>): CalClient | CalAccounts {
  if (env.CAL_ACCOUNTS !== undefined) {
    let accounts: unknown;
    try {
      accounts = JSON.parse(env.CAL_ACCOUNTS);
    } catch {
      throw new Error("CAL_ACCOUNTS must be valid JSON");
    }
    const parsed = z.record(accountSchema).safeParse(accounts);
    if (!parsed.success)
      throw new Error("CAL_ACCOUNTS must map account names to apiKey, optional apiUrl and webUrl");
    return new CalAccounts({
      accounts: Object.fromEntries(
        Object.entries(parsed.data).map(([name, account]) => [
          name,
          {
            ...account,
            apiUrl: account.apiUrl ?? env.CAL_API_URL,
            webUrl: account.webUrl ?? env.CAL_WEB_URL,
          },
        ])
      ),
      defaultAccount: env.CAL_DEFAULT_ACCOUNT,
    });
  }
  if (!env.CAL_API_KEY) throw new Error("CAL_API_KEY or CAL_ACCOUNTS is required");
  return new CalClient({ apiKey: env.CAL_API_KEY, baseUrl: env.CAL_API_URL, webUrl: env.CAL_WEB_URL });
}
