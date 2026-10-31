"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { formatMoney, parseAmountToMinor } from "@/lib/financial/money";

interface Row {
  /** Stable across removals, so React keeps each row's typed values. */
  key: number;
  /**
   * Controlled, and for the same reason the selects are sticky: React resets
   * the form once the action settles, and a reset restores an uncontrolled
   * input to its original attribute — which, for a row added in the browser,
   * is empty. What was typed would be silently dropped on exactly the
   * submission that was rejected and is about to be retried.
   */
  title: string;
  /** Controlled too, and additionally because the running total needs it. */
  amount: string;
}

function emptyRow(key: number): Row {
  return { key, title: "", amount: "" };
}

/**
 * The split-charge section of the accounting panel.
 *
 * "Split charges: Yes" used to be the whole feature — a flag saying a total
 * had been divided, with nowhere to say how. The division lived in the notes,
 * if anywhere. These rows record it as data: what each part of the total is
 * for and how much of it, checked against the total fare before the booking
 * is accepted.
 *
 * A split is not necessarily across cards — a deposit and a balance divide a
 * total just as much — so the line is named rather than attributed to a card.
 * Which card a charge went to is recorded on the Payment.
 *
 * The rows are controlled rather than left to the DOM, because the running
 * total has to be shown as it is typed. Splits that do not add up to the fare
 * are the common entry mistake, and finding out at the point of typing beats
 * finding out from a rejected submission.
 */
export function ChargeSplits({
  value,
  error,
  sectionHasError,
  currency,
}: {
  value: (field: string, fallback?: string) => string;
  error: (field: string) => string | undefined;
  sectionHasError: (prefix: string) => boolean;
  currency: string;
}) {
  const [enabled, setEnabled] = useState(
    () => value("splitCharges", "false") === "true",
  );

  // Rebuilt from the rejected submission, so a server-side refusal does not
  // cost the operator everything they typed.
  const [rows, setRows] = useState<Row[]>(() => {
    const restored: Row[] = [];
    for (let index = 0; index < 20; index += 1) {
      const title = value(`splits.${index}.title`);
      const amount = value(`splits.${index}.amount`);
      if (!title && !amount) continue;
      restored.push({ key: index, title, amount });
    }

    return restored.length > 0 ? restored : [emptyRow(0), emptyRow(1)];
  });

  const [nextKey, setNextKey] = useState(() => rows.length);

  // The total fare is a sibling field in the same panel and is not ours to
  // own, so it is read where it lives. Reaching for the input directly keeps
  // one source of truth for the figure the splits must match.
  const root = useRef<HTMLDivElement>(null);
  const [totalFare, setTotalFare] = useState(() => value("total"));

  useEffect(() => {
    if (!enabled) return;

    const input = root.current
      ?.closest("form")
      ?.elements.namedItem("total") as HTMLInputElement | null;
    if (!input) return;

    setTotalFare(input.value);
    const sync = () => setTotalFare(input.value);
    input.addEventListener("input", sync);
    return () => input.removeEventListener("input", sync);
  }, [enabled]);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const addRow = () => {
    setRows((current) => [...current, emptyRow(nextKey)]);
    setNextKey((key) => key + 1);
  };

  const removeRow = (key: number) =>
    setRows((current) =>
      current.length <= 2 ? current : current.filter((row) => row.key !== key),
    );

  // Summed in minor units: adding decimal strings as floats is how a cent of
  // drift gets into a figure that is then compared for equality.
  let splitTotalMinor = 0;
  let everyAmountParsed = true;

  for (const row of rows) {
    if (row.amount.trim() === "") {
      everyAmountParsed = false;
      continue;
    }
    const minor = parseAmountToMinor(row.amount, currency);
    if (minor === null) {
      everyAmountParsed = false;
      continue;
    }
    splitTotalMinor += minor;
  }

  const fareMinor = parseAmountToMinor(totalFare, currency);
  const matches =
    everyAmountParsed && fareMinor !== null && fareMinor === splitTotalMinor;

  return (
    <div ref={root} className="sm:col-span-2 lg:col-span-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="splitCharges" label="Split charges" error={error("splitCharges")}>
          {(props) => (
            <StickySelect
              {...props}
              name="splitCharges"
              defaultValue={enabled ? "true" : "false"}
              onChange={(event) => setEnabled(event.target.value === "true")}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </StickySelect>
          )}
        </Field>
      </div>

      {enabled ? (
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
            How the total is split
          </legend>

          {sectionHasError("splits") ? (
            <p role="alert" className="mt-1 text-xs text-status-danger">
              {error("splits") ?? "Check the split charges below."}
            </p>
          ) : null}

          <div className="mt-2 flex flex-col gap-3">
            {rows.map((row, index) => (
              <div
                key={row.key}
                className="relative rounded-md border border-line bg-surface-muted/50 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                    Split {index + 1}
                  </span>
                  {rows.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="rounded p-1 text-ink-muted hover:bg-status-danger-bg hover:text-status-danger"
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Remove split {index + 1}</span>
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`splits.${index}.title`}
                    label="Title"
                    hint="What this part of the total is for."
                    error={error(`splits.${index}.title`)}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        name={`splits.${index}.title`}
                        placeholder="Deposit"
                        value={row.title}
                        onChange={(event) =>
                          update(row.key, { title: event.target.value })
                        }
                      />
                    )}
                  </Field>

                  <Field
                    id={`splits.${index}.amount`}
                    label="Amount"
                    hint="Digits and a decimal point."
                    error={error(`splits.${index}.amount`)}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        name={`splits.${index}.amount`}
                        inputMode="decimal"
                        placeholder="900.00"
                        value={row.amount}
                        onChange={(event) =>
                          update(row.key, { amount: event.target.value })
                        }
                      />
                    )}
                  </Field>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" size="sm" onClick={addRow}>
              <Plus />
              Add split
            </Button>

            <p
              className={
                matches
                  ? "text-xs text-status-success"
                  : "text-xs text-ink-muted"
              }
            >
              Splits total {formatMoney(splitTotalMinor, currency)} of{" "}
              {fareMinor === null
                ? "the total fare"
                : formatMoney(fareMinor, currency)}
              {matches ? " ✓" : null}
            </p>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
