import { describe, expect, it } from "vitest";

import { renderAdminNotice } from "@/lib/mail/admin-notice";

/**
 * The internal copy sent to the business when a customer email goes out.
 *
 * Two things are worth pinning down. The booking number has to lead the
 * subject, because these arrive in a stream and that is what an operator
 * scans for. And a row with nothing in it must disappear rather than print an
 * empty label — most notices carry a few of those, and a notice that is half
 * blank lines reads as broken.
 */

const BASE = {
  headline: "Authorization email sent",
  bookingNumber: "BK-1042",
};

describe("renderAdminNotice", () => {
  it("leads the subject with the booking number", () => {
    const notice = renderAdminNotice({ ...BASE, rows: [] });

    expect(notice.subject).toBe("[BK-1042] Authorization email sent");
  });

  it("drops rows with no value and keeps the rest", () => {
    const notice = renderAdminNotice({
      ...BASE,
      rows: [
        { label: "Customer", value: "Gopinder Kumar" },
        { label: "Sent by", value: null },
        { label: "Device", value: "   " },
        { label: "Sent to", value: "gopinder@example.com" },
      ],
    });

    expect(notice.text).toContain("Customer: Gopinder Kumar");
    expect(notice.text).toContain("Sent to: gopinder@example.com");
    expect(notice.text).not.toContain("Sent by");
    expect(notice.text).not.toContain("Device");
    expect(notice.html).not.toContain("Sent by");
  });

  it("offers a link to the booking only when one is known", () => {
    const withLink = renderAdminNotice({
      ...BASE,
      rows: [],
      bookingUrl: "https://crm.example.com/admin/bookings/abc",
    });
    const without = renderAdminNotice({ ...BASE, rows: [], bookingUrl: null });

    expect(withLink.html).toContain(
      'href="https://crm.example.com/admin/bookings/abc"',
    );
    expect(without.html).not.toContain("<a href");
    expect(without.text).not.toContain("Open the booking");
  });

  it("escapes values rather than trusting them as markup", () => {
    const notice = renderAdminNotice({
      ...BASE,
      rows: [{ label: "Customer", value: '<script>alert("x")</script>' }],
    });

    expect(notice.html).not.toContain("<script>");
    expect(notice.html).toContain("&lt;script&gt;");
  });

  it("says plainly that the customer does not receive it", () => {
    const notice = renderAdminNotice({ ...BASE, rows: [] });

    expect(notice.text).toContain("The customer does not receive it.");
    expect(notice.html).toContain("The customer does not receive it.");
  });
});
