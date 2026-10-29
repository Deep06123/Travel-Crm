"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

import { Select } from "@/components/ui/field";

/**
 * A `<select>` that survives the form reset React performs after an action.
 *
 * React resets a `<form action={…}>` once the action settles. A reset restores
 * each control to its *default*: for an `<input>` that is the `value`
 * attribute, which React keeps in step with `defaultValue`, so a rejected
 * submission comes back with the typed text intact. A `<select>` has no such
 * attribute — React assigns `select.value` imperatively and never marks an
 * `<option selected>` — so the reset drops it to the first option instead.
 *
 * The visible result was a booking form that, on any validation failure,
 * handed back every typed field but silently cleared Customer, Booking type,
 * Supplier and the rest. Customer is required, so the next submit failed on
 * "Select a customer" for a customer the operator had already selected.
 *
 * Holding the value in state is half the fix: `defaultValue` carries what the
 * server remembered, and a change to it re-seeds the selection after a failed
 * submit. It is not the whole fix, because React calls `form.reset()` *after*
 * it has committed that render — a raw DOM write with no React render behind
 * it, which a controlled value does not survive. So the reset is also listened
 * for, and the owned value put back once the browser has finished resetting.
 */
export function StickySelect({
  defaultValue = "",
  onChange,
  ...props
}: Omit<ComponentProps<"select">, "value" | "defaultValue"> & {
  defaultValue?: string | undefined;
}) {
  const [value, setValue] = useState(defaultValue);

  // Re-seed when the server sends back a different remembered value. Adjusting
  // state during render rather than in an effect: React restarts the render
  // immediately with the new value, so the select never paints the stale one.
  const [seed, setSeed] = useState(defaultValue);
  if (seed !== defaultValue) {
    setSeed(defaultValue);
    setValue(defaultValue);
  }

  const ref = useRef<HTMLSelectElement>(null);

  // Read inside the listener rather than captured, so the handler can be
  // registered once and still see the current selection. Written after the
  // commit, which is still before the reset listener's timeout runs.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;

    const restore = () => {
      // The reset event fires before the browser clears the controls, so the
      // value goes back on the next task, once there is something to undo.
      setTimeout(() => {
        const element = ref.current;
        if (element && element.value !== latest.current) {
          element.value = latest.current;
        }
      }, 0);
    };

    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, []);

  return (
    <Select
      {...props}
      ref={ref}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event);
      }}
    />
  );
}
