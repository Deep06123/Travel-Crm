"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/status-badge";
import { BookingStatus } from "@/generated/prisma/enums";
import type { ListEditableStatus } from "@/lib/bookings/status";
import { cn } from "@/lib/utils";

import { setListBookingStatusAction, type ListStatusState } from "./actions";

/**
 * Pending ⇄ Confirmed, from the bookings list.
 *
 * The rest of this row is read-only on purpose — see `RowActions` — and this
 * is a deliberate exception rather than a hole in that rule. It offers exactly
 * two states, neither destructive and neither one the service asks for a
 * reason to enter. Cancelling and sending back for review still live on the
 * booking page, because both are moves somebody will have to account for later
 * and a table row is no place to write that down.
 *
 * A menu rather than a drag target. A column this narrow gives a drag perhaps
 * twenty pixels of slop before the drop lands on the wrong row, and a drag has
 * no keyboard or touch equivalent at all — so the gesture that reads as direct
 * manipulation on a board becomes the slowest and least reliable way to do
 * this in a dense table.
 *
 * Nothing here is the control: `setListBookingStatusAction` re-checks the
 * permission, the transition matrix and the evidence on every submission. This
 * narrows what gets asked, and shows the answer when the server says no.
 */

/**
 * The two states offered, in lifecycle order.
 *
 * The set itself is `LIST_EDITABLE_STATUSES` in `lib/bookings/status`, which
 * the server page reads to decide which cells get a control at all. This adds
 * only how each one is drawn.
 */
const OPTIONS = [
  { value: BookingStatus.PENDING, label: "Pending", tone: "warning" },
  { value: BookingStatus.CONFIRMED, label: "Confirmed", tone: "success" },
] as const satisfies readonly {
  value: ListEditableStatus;
  label: string;
  tone: string;
}[];

/** The menu's own height: two rows plus its padding. */
const MENU_HEIGHT = 76;

export function ListStatusControl({
  bookingId,
  bookingNumber,
  currentStatus,
}: {
  bookingId: string;
  /** Names the booking in the control's accessible label. */
  bookingNumber: string;
  currentStatus: ListEditableStatus;
}) {
  const [state, formAction, pending] = useActionState<ListStatusState, FormData>(
    setListBookingStatusAction,
    {},
  );

  /**
   * Where the menu is pinned, in viewport coordinates, or null when shut.
   *
   * The menu is `fixed` against these rather than absolute against the cell,
   * because the table scrolls sideways inside a container that clips its
   * overflow — an absolutely-positioned menu was sliced off at the card's
   * edge, which cut the bottom row's options in half. A fixed element is not
   * clipped by an ancestor's overflow, so the position is measured off the
   * trigger once, when it opens.
   *
   * The position *is* the open state. Keeping them as two pieces of state is
   * how a menu ends up open at coordinates from where the row used to be.
   */
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const current =
    OPTIONS.find((option) => option.value === currentStatus) ?? OPTIONS[0];

  /**
   * Closes the menu once the server has answered, during render.
   *
   * Deliberately not an `onClick` on the menu item. Closing in the same tick
   * as the click unmounted the submit button before the browser dispatched
   * the form submission — so the menu shut, nothing was sent, and the badge
   * simply never changed. A control that silently does nothing is worse than
   * one that refuses.
   *
   * Nor an effect: adjusting state during render is React's own answer for
   * state derived from props, and it settles before anything is painted
   * rather than a frame later.
   *
   * Keyed on both outcomes — a new status for a move that landed, a new
   * message for one that was refused — because the second leaves the status
   * exactly where it was and would otherwise never close.
   */
  const answer = `${currentStatus}:${state.error ?? ""}`;
  const [lastAnswer, setLastAnswer] = useState(answer);

  if (lastAnswer !== answer) {
    setLastAnswer(answer);
    setAnchor(null);
  }

  // While the move is in flight the badge already shows a spinner, so a menu
  // hanging over it has nothing left to say. Hidden by deriving it rather than
  // by clearing the anchor, which would unmount the button mid-submit.
  const menuOpen = anchor !== null && !pending;

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Opens upward when there is no room below, so the last row of a full
    // page is as usable as the first.
    const room = window.innerHeight - rect.bottom;
    const top = room < MENU_HEIGHT ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4;

    setAnchor({ top, left: rect.left });
  }

  /**
   * Click-away, Escape, and anything that moves the row out from under it.
   *
   * The scroll and resize listeners are what a fixed position costs: the menu
   * no longer travels with the cell it belongs to, so it has to be dismissed
   * rather than left floating over an unrelated row. Closing is the honest
   * response — re-measuring mid-scroll would make it chase the pointer.
   */
  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setAnchor(null);

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Capture, so a scroll inside the table's own container is caught too —
    // a scroll event from an element does not bubble to the document.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuOpen]);

  return (
    <div ref={containerRef}>
      <form action={formAction}>
        <input type="hidden" name="bookingId" value={bookingId} />

        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          className="flex items-center gap-1 rounded disabled:opacity-60"
          title={`Change the status of booking ${bookingNumber}`}
        >
          <Badge tone={current.tone}>{current.label}</Badge>
          {pending ? (
            <Loader2 className="size-3 animate-spin text-ink-muted" />
          ) : (
            <ChevronDown className="size-3 text-ink-muted" />
          )}
          <span className="sr-only">
            Booking {bookingNumber} is {current.label}. Change its status.
          </span>
        </button>

        {menuOpen ? (
          <div
            id={menuId}
            role="menu"
            style={{ top: anchor.top, left: anchor.left }}
            className="fixed z-50 min-w-[9rem] overflow-hidden rounded-md border border-line bg-white py-1 shadow-lg"
          >
            {OPTIONS.map((option) => {
              const isCurrent = option.value === currentStatus;

              return (
                <button
                  key={option.value}
                  type="submit"
                  name="toStatus"
                  value={option.value}
                  role="menuitem"
                  // No onClick: closing the menu from here unmounts this very
                  // button before the browser dispatches the submit, so the
                  // form never sends. See the render-time close above.
                  //
                  // Submitting the status it already has would write a
                  // transition from a state to itself, which the matrix
                  // rejects — so the row would report an error for a click
                  // that asked for nothing.
                  disabled={isCurrent}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                    isCurrent
                      ? "cursor-default font-semibold text-ink"
                      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                  )}
                >
                  <Check
                    className={cn("size-3", isCurrent ? "opacity-100" : "opacity-0")}
                  />
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </form>

      {/* The refusal, in the row it belongs to. These are the lifecycle rules
          talking — "needs an airline or supplier confirmation reference",
          "cannot move from CONFIRMED to PENDING" — and they are the whole
          reason the badge did not change, so they are shown rather than
          logged. */}
      {state.error ? (
        <p
          role="alert"
          className="mt-1 max-w-[14rem] text-xs leading-snug text-status-danger"
        >
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
