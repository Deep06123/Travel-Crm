"use client";

import { KeyRound, Loader2, ShieldAlert, Unlock, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { AdminRole, AdminUserStatus } from "@/generated/prisma/enums";

import {
  createAgentAction,
  resetAgentPasswordAction,
  unlockAgentAction,
  updateAgentAction,
  type AgentFormState,
} from "./agent-actions";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton({ label, icon }: { label: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : icon}
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Shows a provisioning password once.
 *
 * This is the only moment the value exists outside the operator's screen —
 * only its bcrypt digest is stored, so it cannot be looked up again. The
 * reference CRM's plaintext password column is deliberately not reproduced.
 */
function OneTimePassword({ password }: { password: string }) {
  return (
    <div className="rounded-md border border-status-warning/40 bg-status-warning-bg p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
        <ShieldAlert className="size-4" />
        One-time password — shown now and never again
      </p>
      <code className="mt-2 block rounded bg-white px-3 py-2 font-mono text-sm break-all text-ink select-all">
        {password}
      </code>
      <p className="mt-2 text-xs text-ink-muted">
        Give this to the agent through a channel you trust. It is stored only as
        a hash, so nobody — including you — can retrieve it later. They will be
        required to set their own password at first sign-in.
      </p>
    </div>
  );
}

function Feedback({ state }: { state: AgentFormState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success">
          {state.success}
        </p>
      ) : null}
      {state.oneTimePassword ? <OneTimePassword password={state.oneTimePassword} /> : null}
    </>
  );
}

export function CreateAgentForm() {
  const [state, formAction] = useActionState<AgentFormState, FormData>(
    createAgentAction,
    {},
  );

  const value = (field: string) => state.values?.[field] ?? "";
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />

      <Field id="agent-name" label="Full name" required error={error("name")}>
        {(props) => <Input {...props} name="name" required defaultValue={value("name")} />}
      </Field>

      <Field id="agent-email" label="Email" required error={error("email")}>
        {(props) => (
          <Input {...props} name="email" type="email" required defaultValue={value("email")} />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="agent-username"
          label="Username"
          hint="Short handle for the floor. Optional."
          error={error("username")}
        >
          {(props) => <Input {...props} name="username" defaultValue={value("username")} />}
        </Field>

        <Field id="agent-phone" label="Phone" error={error("phone")}>
          {(props) => <Input {...props} name="phone" type="tel" defaultValue={value("phone")} />}
        </Field>

        <Field id="agent-role" label="Role" required error={error("role")}>
          {(props) => (
            <StickySelect {...props} name="role" defaultValue={value("role") || AdminRole.OPERATIONS}>
              {Object.values(AdminRole).map((role) => (
                <option key={role} value={role}>
                  {humanise(role)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field id="agent-dialer" label="Dialer ID" error={error("dialerId")}>
          {(props) => <Input {...props} name="dialerId" defaultValue={value("dialerId")} />}
        </Field>

        <Field id="agent-team" label="Team" error={error("team")} className="sm:col-span-2">
          {(props) => <Input {...props} name="team" defaultValue={value("team")} />}
        </Field>
      </div>

      <p className="text-xs text-ink-muted">
        A strong password is generated automatically and shown once. You do not
        choose it, and it is never stored in a form anyone can read back.
      </p>

      <div>
        <SubmitButton label="Create agent" icon={<UserPlus />} />
      </div>
    </form>
  );
}

export function EditAgentForm({
  agentId,
  defaults,
}: {
  agentId: string;
  defaults: {
    name: string;
    phone: string;
    role: AdminRole;
    status: AdminUserStatus;
    dialerId: string;
    team: string;
    isActive: boolean;
    allowedIpRanges: string[];
  };
}) {
  const [state, formAction] = useActionState<AgentFormState, FormData>(
    updateAgentAction,
    {},
  );
  const [status, setStatus] = useState<string>(defaults.status);

  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="agentId" value={agentId} />
      <Feedback state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="edit-name" label="Full name" required error={error("name")}>
          {(props) => <Input {...props} name="name" required defaultValue={defaults.name} />}
        </Field>

        <Field id="edit-phone" label="Phone" error={error("phone")}>
          {(props) => <Input {...props} name="phone" type="tel" defaultValue={defaults.phone} />}
        </Field>

        <Field id="edit-role" label="Role" required error={error("role")}>
          {(props) => (
            <StickySelect {...props} name="role" defaultValue={defaults.role}>
              {Object.values(AdminRole).map((role) => (
                <option key={role} value={role}>
                  {humanise(role)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field
          id="edit-status"
          label="Account status"
          required
          hint={
            status === AdminUserStatus.ACTIVE
              ? undefined
              : "Saving will immediately revoke every live session for this account."
          }
          error={error("status")}
        >
          {(props) => (
            <StickySelect
              {...props}
              name="status"
              defaultValue={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {Object.values(AdminUserStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </StickySelect>
          )}
        </Field>

        <Field id="edit-dialer" label="Dialer ID" error={error("dialerId")}>
          {(props) => <Input {...props} name="dialerId" defaultValue={defaults.dialerId} />}
        </Field>

        <Field id="edit-team" label="Team" error={error("team")}>
          {(props) => <Input {...props} name="team" defaultValue={defaults.team} />}
        </Field>

        <Field id="edit-active" label="Rostered" error={error("isActive")}>
          {(props) => (
            <StickySelect {...props} name="isActive" defaultValue={String(defaults.isActive)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </StickySelect>
          )}
        </Field>
      </div>

      <Field
        id="edit-ips"
        label="Allowed IP ranges"
        hint="One CIDR per line. A network control only — it never replaces sign-in."
        error={error("allowedIpRanges")}
      >
        {(props) => (
          <Textarea
            {...props}
            name="allowedIpRanges"
            rows={3}
            className="font-mono text-xs"
            defaultValue={defaults.allowedIpRanges.join("\n")}
          />
        )}
      </Field>

      <div>
        <SubmitButton label="Save changes" />
      </div>
    </form>
  );
}

export function AgentSecurityActions({
  agentId,
  isLocked,
}: {
  agentId: string;
  isLocked: boolean;
}) {
  const [resetState, resetAction] = useActionState<AgentFormState, FormData>(
    resetAgentPasswordAction,
    {},
  );
  const [unlockState, unlockActionFn] = useActionState<AgentFormState, FormData>(
    unlockAgentAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Feedback state={resetState} />
      <Feedback state={unlockState} />

      {isLocked ? (
        <form action={unlockActionFn}>
          <input type="hidden" name="agentId" value={agentId} />
          <SubmitButton label="Clear lockout" icon={<Unlock />} />
        </form>
      ) : null}

      {confirming ? (
        <form action={resetAction} className="flex flex-col gap-2">
          <input type="hidden" name="agentId" value={agentId} />
          <p className="rounded-md bg-status-warning-bg px-3 py-2 text-sm text-status-warning">
            This issues a new one-time password and signs the agent out
            everywhere. Their current password stops working immediately.
          </p>
          <div className="flex items-center gap-2">
            <SubmitButton label="Confirm reset" icon={<KeyRound />} />
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          <KeyRound />
          Reset password
        </Button>
      )}
    </div>
  );
}
