"use client";

import { Label, Select } from "@/components/ui/field";

/**
 * Which address a customer email goes out from.
 *
 * Renders nothing when there is at most one account to choose between: a
 * select with a single option is a control that cannot be used, and it would
 * sit beside every send button on the page saying nothing. With none
 * configured the send falls back to the server's `SMTP_*` settings, which is
 * also not a choice anyone can make here.
 *
 * The value posts as `mailAccountId`. Empty means "use the default for this
 * kind of message", which is what the settings page configures — so an
 * operator who never touches this control still gets the intended sender.
 */
export interface SenderOption {
  id: string;
  label: string;
  fromEmail: string;
  fromName: string | null;
}

export function SenderSelect({
  options,
  value,
  onChange,
  /** Named so two of these on one page are still distinguishable to a reader. */
  id,
}: {
  options: readonly SenderOption[];
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  if (options.length < 2) return null;

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-ink-muted">
        Send from
      </Label>

      <Select
        id={id}
        name="mailAccountId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-64"
      >
        {/* First, and the default: the settings answer, whatever it is today.
            Spelling it out beats a blank option that reads as "none". */}
        <option value="">Default for this email</option>

        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label} — {option.fromEmail}
          </option>
        ))}
      </Select>
    </div>
  );
}
