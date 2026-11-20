import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RsvpForm from "./RsvpForm";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@calcom/ui/components/alert/Alert", () => ({
  Alert: ({ message }: { message: string }) => <span>{message}</span>,
}));
vi.mock("@calcom/ui/components/button/Button", () => ({
  Button: ({ children, type, onClick, disabled }: ComponentProps<"button">) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@calcom/ui/components/form/inputs/TextField", () => ({
  TextField: ({ name, type, defaultValue }: ComponentProps<"input">) => (
    <input aria-label={name} name={name} type={type} defaultValue={defaultValue} />
  ),
}));
function submit(email = "reader@example.com") {
  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Reader" } });
  fireEvent.change(screen.getByLabelText("email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "community_event_save" }));
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("RSVP form tokens", () => {
  it("stores the returned token and sends it after remounting", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ data: { uid: "saved" } }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetcher);
    const view = render(<RsvpForm uid="event" />);
    submit(" READER@EXAMPLE.COM ");
    await waitFor(() =>
      expect(localStorage.getItem("community-event-rsvp:event:reader@example.com")).toBe("saved")
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("rsvpUid");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toHaveProperty("email", "reader@example.com");
    view.unmount();
    render(<RsvpForm uid="event" />);
    submit();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toHaveProperty("rsvpUid", "saved");
  });
  it.each([false, true])("keeps each email's token separate when storage is blocked=%s", async (blocked) => {
    if (blocked) {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("Unavailable");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Unavailable");
      });
    }
    const fetcher = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const { email } = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ data: { uid: `token:${email}` } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<RsvpForm uid="event" />);
    const emails = ["reader@example.com", "second@example.com", "READER@EXAMPLE.COM", "second@example.com"];
    for (let index = 0; index < emails.length; index++) {
      const email = emails[index];
      submit(email);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "community_event_save" })).toHaveProperty("disabled", false)
      );
      const body = JSON.parse(fetcher.mock.calls[index][1].body);
      expect(body.rsvpUid).toBe(index < 2 ? undefined : `token:${email.toLowerCase()}`);
    }
  });
  it.each([
    ["RSVP_EXISTS", "exists"],
    ["EVENT_FULL", "full"],
  ])("distinguishes %s", async (error, feedback) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 409 }))
    );
    render(<RsvpForm uid="event" />);
    submit();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(`community_event_feedback_${feedback}`)
    );
    expect(localStorage.getItem("community-event-rsvp:event:reader@example.com")).toBeNull();
  });
});
