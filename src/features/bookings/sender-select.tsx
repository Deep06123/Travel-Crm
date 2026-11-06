"use client";

import Link from "next/link";

import { Label, Select } from "@/components/ui/field";

/**
 * Which address a customer email goes out from.
 *
 * Shown as soon as one account is configured, not two. A single-option select
 * looks redundant, but it is the only place on this page that says which
 * mailbox the customer will see — and an agent about to send an authorization
 * should be able to read that without opening Settings.
 *
 * With none configured there is nothing to pick: the send falls back to the
 * server's `SMTP_*` variables. Rather than render an empty control, this says
 * so once — and only to someone who can act on it, because a line telling an
 * agent to visit a page their role refuses is worse than silence.
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
  canManageSettings = false,
}: {
  options: readonly SenderOption[];
  value: string;
  onChange: (value: string) => void;
  id: string;
  /** Whether to offer the route out when nothing is configured. */
  canManageSettings?: boolean;
}) {
  if (options.length === 0) {
    if (!canManageSettings) return null;

    return (
      <p className="text-xs text-ink-subtle">
        Sending from the server&rsquo;s SMTP settings.{" "}
        <Link href="/admin/settings" className="underline">
          Add a sending account
        </Link>{" "}
        to choose the address customers see.
      </p>
    );
  }

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
