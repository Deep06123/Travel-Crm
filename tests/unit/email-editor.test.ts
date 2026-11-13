// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailEditor } from "@/features/bookings/email-editor";

/**
 * What the editor actually posts.
 *
 * The renderer honours an override and the service carries it to the socket,
 * both covered elsewhere — so the only remaining place an operator's edit can
 * be lost is between the textarea and the action. This asserts the fields are
 * in the submission at all.
 */

afterEach(cleanup);

describe("the email editor's submission", () => {
  it("posts the edited subject and message alongside the hidden fields", async () => {
    const formAction = vi.fn();

    render(
      createElement(EmailEditor, {
        title: "Authorization email",
        fieldKey: "authorization-b1",
        recipient: "customer@example.invalid",
        subject: "Generated subject",
        body: "Generated body",
        hidden: { bookingId: "b1", intent: "send" },
        onClose: () => {},
        formAction,
      }),
    );

    fireEvent.change(screen.getByLabelText(/Subject/), {
      target: { value: "This is testing email again testing" },
    });
    fireEvent.change(screen.getByLabelText(/Message/), {
      target: { value: "ffffffff" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send this version" }));

    await waitFor(() => expect(formAction).toHaveBeenCalledTimes(1));

    const posted = formAction.mock.calls[0]![0] as FormData;
    expect(posted.get("bookingId")).toBe("b1");
    expect(posted.get("intent")).toBe("send");
    expect(posted.get("subject")).toBe("This is testing email again testing");
    expect(posted.get("body")).toBe("ffffffff");
  });
});
