"use client";

import {
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

import {
  deleteMailAccountAction,
  saveMailAccountAction,
  saveMailDefaultsAction,
  verifyMailAccountAction,
  type MailAccountFormState,
} from "./mail-account-actions";

/**
 * The mailboxes customer email is sent from, and which one each kind of
 * message uses.
 *
 * Before this the sender was an `SMTP_*` environment variable, so changing the
 * address a customer sees meant a server login and a redeploy. An operator can
 * now add a mailbox, prove the credentials work without sending anything, and
 * point authorizations and e-tickets at different addresses.
 *
 * The stored password is never sent to this page — only whether one exists.
 * Leaving the password box empty on an edit keeps what is stored.
 */

export interface MailAccountRow {
  id: string;
  label: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  hasPassword: boolean;
  saveToSent: boolean;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  sentFolder: string | null;
  /** What the IMAP host resolves to, configured or derived. */
  effectiveImapHost: string | null;
  isActive: boolean;
  /** Pre-formatted: this is a Client Component and `@/lib/format` is server-only. */
  verifiedAtLabel: string | null;
  lastError: string | null;
}

export interface MailPurposeRow {
  purpose: string;
  label: string;
  selectedId: string;
}

function Banner({ state }: { state: MailAccountFormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
      >
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
      >
        {state.success}
      </p>
    );
  }

  return null;
}

function PendingButton({
  label,
  pendingLabel,
  icon,
  variant,
}: {
  label: string;
  pendingLabel: string;
  icon: React.ReactNode;
  variant?: "secondary" | "destructive";
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending}
      {...(variant ? { variant } : {})}
    >
      {pending ? <Loader2 className="animate-spin" /> : icon}
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Add or edit one account.
 *
 * `account` absent is the add form. The two are the same fields in the same
 * order on purpose: an operator who has filled one in once should not have to
 * read the other.
 */
function AccountForm({
  account,
  onDone,
}: {
  account?: MailAccountRow;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<MailAccountFormState, FormData>(
    saveMailAccountAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Banner state={state} />

      {account ? <input type="hidden" name="id" value={account.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`mail-label-${account?.id ?? "new"}`}
          label="Name"
          hint="What staff pick from, e.g. Reservations"
        >
          {(props) => (
            <Input
              {...props}
              name="label"
              required
              maxLength={80}
              defaultValue={account?.label ?? ""}
              placeholder="Reservations"
            />
          )}
        </Field>

        <Field
          id={`mail-from-${account?.id ?? "new"}`}
          label="From address"
          hint="The address the customer sees and replies to"
        >
          {(props) => (
            <Input
              {...props}
              name="fromEmail"
              type="email"
              required
              defaultValue={account?.fromEmail ?? ""}
              placeholder="info@example.com"
            />
          )}
        </Field>

        <Field
          id={`mail-fromname-${account?.id ?? "new"}`}
          label="Display name"
          hint="Optional. Shown instead of the bare address."
        >
          {(props) => (
            <Input
              {...props}
              name="fromName"
              maxLength={120}
              defaultValue={account?.fromName ?? ""}
              placeholder="Cruise Confirmations"
            />
          )}
        </Field>

        <Field
          id={`mail-replyto-${account?.id ?? "new"}`}
          label="Reply-to"
          hint="Optional. Where replies land, if not the from address."
        >
          {(props) => (
            <Input
              {...props}
              name="replyTo"
              type="email"
              defaultValue={account?.replyTo ?? ""}
            />
          )}
        </Field>

        <Field id={`mail-host-${account?.id ?? "new"}`} label="SMTP host">
          {(props) => (
            <Input
              {...props}
              name="host"
              required
              defaultValue={account?.host ?? ""}
              placeholder="smtp.hostinger.com"
            />
          )}
        </Field>

        <Field
          id={`mail-port-${account?.id ?? "new"}`}
          label="Port"
          hint="587 with STARTTLS, or 465 with implicit TLS"
        >
          {(props) => (
            <Input
              {...props}
              name="port"
              type="number"
              min={1}
              max={65535}
              required
              defaultValue={account?.port ?? 587}
            />
          )}
        </Field>

        <Field
          id={`mail-user-${account?.id ?? "new"}`}
          label="Username"
          hint="Usually the full mailbox address"
        >
          {(props) => (
            <Input
              {...props}
              name="username"
              autoComplete="off"
              defaultValue={account?.username ?? ""}
            />
          )}
        </Field>

        <Field
          id={`mail-pass-${account?.id ?? "new"}`}
          label="Password"
          hint={
            account?.hasPassword
              ? "Stored. Leave empty to keep it."
              : "Stored encrypted; never shown again."
          }
        >
          {(props) => (
            <Input
              {...props}
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={account?.hasPassword ? "••••••••" : ""}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="secure"
            defaultChecked={account?.secure ?? false}
          />
          Implicit TLS (port 465)
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={account?.isActive ?? true}
          />
          Available for sending
        </label>

        {/* Only on an edit: there is nothing to clear on a new account, and
            the checkbox would read as "do not set one". */}
        {account?.hasPassword ? (
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="checkbox" name="clearPassword" />
            Remove the stored password
          </label>
        ) : null}
      </div>

      <SentCopyFields account={account} />

      <div className="flex gap-2">
        <PendingButton
          label={account ? "Save changes" : "Add account"}
          pendingLabel="Saving…"
          icon={account ? <Save /> : <Plus />}
        />

        {onDone ? (
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Whether to file a copy of each sent message, and where.
 *
 * The explanation is worth the space because the behaviour surprises people:
 * mail sent by this application is delivered correctly and then nowhere to be
 * found in the mailbox it came from. Saving to Sent is not part of SMTP — a
 * mail client does it separately, over IMAP — so until this is ticked there is
 * nothing to find. Gmail files a copy for you, which is why the gap only shows
 * up after moving to a provider that does not.
 *
 * The host and folder are collapsed until the box is ticked. Both can be left
 * empty: the host is derived from the SMTP host, and the folder is whichever
 * one the server itself flags as Sent.
 */
function SentCopyFields({ account }: { account?: MailAccountRow }) {
  const [enabled, setEnabled] = useState(account?.saveToSent ?? false);
  const id = account?.id ?? "new";

  return (
    <div className="rounded-md border border-line bg-surface-sunken/50 p-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="saveToSent"
          className="mt-1"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          <span className="font-medium text-ink">
            Save a copy in the mailbox&rsquo;s Sent folder
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            Connects over IMAP after each send, the way a mail client does.
            Without this, sent mail is delivered but never appears in the
            mailbox. Uses the username and password above.
          </span>
        </span>
      </label>

      {enabled ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            id={`imap-host-${id}`}
            label="IMAP host"
            hint={
              account?.effectiveImapHost
                ? `Leave empty for ${account.effectiveImapHost}`
                : "Leave empty to derive it from the SMTP host"
            }
          >
            {(props) => (
              <Input
                {...props}
                name="imapHost"
                autoComplete="off"
                placeholder={account?.effectiveImapHost ?? "imap.example.com"}
                defaultValue={account?.imapHost ?? ""}
              />
            )}
          </Field>

          <Field id={`imap-port-${id}`} label="IMAP port">
            {(props) => (
              <Input
                {...props}
                name="imapPort"
                type="number"
                min={1}
                max={65535}
                defaultValue={account?.imapPort ?? 993}
              />
            )}
          </Field>

          <Field
            id={`sent-folder-${id}`}
            label="Sent folder"
            hint="Leave empty to use whichever folder the server marks as Sent"
          >
            {(props) => (
              <Input
                {...props}
                name="sentFolder"
                autoComplete="off"
                placeholder="Sent"
                defaultValue={account?.sentFolder ?? ""}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              name="imapSecure"
              defaultChecked={account?.imapSecure ?? true}
            />
            Implicit TLS (port 993)
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** Connection check and deletion, each its own form — see the nesting rule. */
function AccountControls({ account }: { account: MailAccountRow }) {
  const [verifyState, verifyAction] = useActionState<
    MailAccountFormState,
    FormData
  >(verifyMailAccountAction, {});

  const [deleteState, deleteAction] = useActionState<
    MailAccountFormState,
    FormData
  >(deleteMailAccountAction, {});

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={verifyAction}>
          <input type="hidden" name="id" value={account.id} />
          <PendingButton
            label="Test connection"
            pendingLabel="Connecting…"
            icon={<Send />}
            variant="secondary"
          />
        </form>

        <form action={deleteAction}>
          <input type="hidden" name="id" value={account.id} />
          <PendingButton
            label="Delete"
            pendingLabel="Deleting…"
            icon={<Trash2 />}
            variant="destructive"
          />
        </form>
      </div>

      <Banner state={verifyState} />
      <Banner state={deleteState} />
    </div>
  );
}

function AccountCard({ account }: { account: MailAccountRow }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {account.label}
            {account.isActive ? null : (
              <span className="ml-2 text-xs text-ink-muted">(disabled)</span>
            )}
          </p>
          <p className="text-xs text-ink-muted">
            {account.fromName
              ? `${account.fromName} <${account.fromEmail}>`
              : account.fromEmail}
          </p>
          <p className="text-xs text-ink-subtle">
            {account.host}:{account.port}
            {account.secure ? " · TLS" : " · STARTTLS"}
            {account.username ? ` · ${account.username}` : " · no credentials"}
            {/* Worth a word in the summary: whether sent mail turns up in the
                mailbox is the first thing anyone asks about an account. */}
            {account.saveToSent && account.effectiveImapHost
              ? ` · copies to Sent via ${account.effectiveImapHost}`
              : " · no Sent copy"}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setEditing((open) => !open)}
        >
          {editing ? "Close" : "Edit"}
        </Button>
      </div>

      {/* "Never tested" is said out loud rather than left blank: the other way
          to find out a password is wrong is a customer not receiving their
          authorization. */}
      <p className="mt-2 flex items-center gap-1.5 text-xs">
        {account.lastError ? (
          <>
            <TriangleAlert className="size-3.5 text-status-danger" />
            <span className="text-status-danger">{account.lastError}</span>
          </>
        ) : account.verifiedAtLabel ? (
          <>
            <CheckCircle2 className="size-3.5 text-status-success" />
            <span className="text-ink-muted">
              Connected {account.verifiedAtLabel}
            </span>
          </>
        ) : (
          <span className="text-ink-subtle">
            Never tested — use Test connection before relying on it.
          </span>
        )}
      </p>

      <div className="mt-3">
        <AccountControls account={account} />
      </div>

      {editing ? (
        <div className="mt-3 border-t border-line pt-3">
          <AccountForm account={account} onDone={() => setEditing(false)} />
        </div>
      ) : null}
    </li>
  );
}

/** Which account sends each kind of message when nobody picks one. */
function DefaultsForm({
  purposes,
  accounts,
}: {
  purposes: readonly MailPurposeRow[];
  accounts: readonly MailAccountRow[];
}) {
  const [state, formAction] = useActionState<MailAccountFormState, FormData>(
    saveMailDefaultsAction,
    {},
  );

  const selectable = accounts.filter((account) => account.isActive);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Banner state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        {purposes.map((purpose) => (
          <Field
            key={purpose.purpose}
            id={`mail-default-${purpose.purpose}`}
            label={purpose.label}
          >
            {(props) => (
              <Select
                {...props}
                name={purpose.purpose}
                defaultValue={purpose.selectedId}
              >
                {/* Falling back to the server's SMTP_* settings is a real,
                    supported state, so it is named rather than blank. */}
                <option value="">Server configuration (SMTP_*)</option>
                {selectable.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} — {account.fromEmail}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>

      <div>
        <PendingButton
          label="Save defaults"
          pendingLabel="Saving…"
          icon={<Save />}
        />
      </div>
    </form>
  );
}

export function MailAccountsManager({
  accounts,
  purposes,
}: {
  accounts: readonly MailAccountRow[];
  purposes: readonly MailPurposeRow[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {accounts.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No sending accounts yet. Email goes out using the server&apos;s{" "}
          <code className="text-xs">SMTP_*</code> settings until one is added.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-md border border-line p-3">
          <AccountForm onDone={() => setAdding(false)} />
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add a sending account
          </Button>
        </div>
      )}

      {accounts.length > 0 ? (
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-sm font-medium">Default sender per email</p>
          <DefaultsForm purposes={purposes} accounts={accounts} />
        </div>
      ) : null}
    </div>
  );
}
