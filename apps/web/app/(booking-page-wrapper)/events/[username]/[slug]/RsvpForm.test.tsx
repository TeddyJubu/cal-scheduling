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
function submit() {
  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Reader" } });
  fireEvent.change(screen.getByLabelText("email"), { target: { value: "reader@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "community_event_save" }));
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    submit();
    await waitFor(() => expect(localStorage.getItem("community-event-rsvp:event")).toBe("saved"));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("rsvpUid");
    view.unmount();
    render(<RsvpForm uid="event" />);
    submit();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toHaveProperty("rsvpUid", "saved");
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
    expect(localStorage.getItem("community-event-rsvp:event")).toBeNull();
  });
});
