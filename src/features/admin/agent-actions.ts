"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AdminRole, AdminUserStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  DuplicateAgentError,
  createAgent,
  resetAgentPassword,
  unlockAgent,
  updateAgent,
} from "@/server/services/agent-service";

const log = loggerFor("agent-actions");

export interface AgentFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  /**
   * Returned exactly once, immediately after provisioning or a reset. It is
   * never read back from the database because only its digest is stored.
   */
  oneTimePassword?: string;
  values?: Record<string, string>;
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  username: z.string().trim().toLowerCase().max(60).optional(),
  phone: z.string().trim().max(40).optional(),
  role: z.enum(AdminRole),
  dialerId: z.string().trim().max(40).optional(),
  team: z.string().trim().max(60).optional(),
});

function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function createAgentAction(
  _previous: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const user = await requirePermission(PERMISSIONS.AGENT_MANAGE);

  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return {
      fieldErrors: collectFieldErrors(parsed.error.issues),
      values: formValues(formData),
    };
  }

  try {
    const created = await createAgent(
      {
        name: parsed.data.name,
        email: parsed.data.email,
        username: parsed.data.username || undefined,
        phone: parsed.data.phone || undefined,
        role: parsed.data.role,
        dialerId: parsed.data.dialerId || undefined,
        team: parsed.data.team || undefined,
      },
      user.id,
    );

    revalidatePath("/admin/agents");

    return {
      success: `Agent ${parsed.data.name} created.`,
      oneTimePassword: created.oneTimePassword,
    };
  } catch (error) {
    if (error instanceof DuplicateAgentError) {
      return { error: error.message, values: formValues(formData) };
    }

    log.error({ err: error }, "Failed to create agent");
    return { error: "The agent could not be created. Try again.", values: formValues(formData) };
  }
}

const updateSchema = z.object({
  agentId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  phone: z.string().trim().max(40).optional(),
  role: z.enum(AdminRole),
  status: z.enum(AdminUserStatus),
  dialerId: z.string().trim().max(40).optional(),
  team: z.string().trim().max(60).optional(),
  isActive: z.coerce.boolean().default(true),
  /** Newline- or comma-separated CIDR ranges. */
  allowedIpRanges: z.string().trim().max(2_000).optional(),
});

export async function updateAgentAction(
  _previous: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const user = await requirePermission(PERMISSIONS.AGENT_MANAGE);

  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  const allowedIpRanges = (parsed.data.allowedIpRanges ?? "")
    .split(/[\n,]/)
    .map((range) => range.trim())
    .filter(Boolean);

  try {
    await updateAgent(
      parsed.data.agentId,
      {
        name: parsed.data.name,
        phone: parsed.data.phone || undefined,
        role: parsed.data.role,
        status: parsed.data.status,
        dialerId: parsed.data.dialerId || undefined,
        team: parsed.data.team || undefined,
        isActive: parsed.data.isActive,
        allowedIpRanges,
      },
      user.id,
    );
  } catch (error) {
    if (error instanceof DuplicateAgentError) return { error: error.message };

    log.error({ err: error }, "Failed to update agent");
    return { error: "The changes could not be saved. Try again." };
  }

  revalidatePath("/admin/agents");
  revalidatePath(`/admin/agents/${parsed.data.agentId}`);
  return { success: "Agent updated." };
}

const agentIdSchema = z.object({ agentId: z.string().trim().min(1) });

export async function resetAgentPasswordAction(
  _previous: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const user = await requirePermission(PERMISSIONS.AGENT_MANAGE);

  const parsed = agentIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const oneTimePassword = await resetAgentPassword(parsed.data.agentId, user.id);

    revalidatePath(`/admin/agents/${parsed.data.agentId}`);

    return {
      success:
        "Password reset. Every session for this account has been revoked and they must set a new password at next sign-in.",
      oneTimePassword,
    };
  } catch (error) {
    log.error({ err: error }, "Failed to reset agent password");
    return { error: "The password could not be reset. Try again." };
  }
}

export async function unlockAgentAction(
  _previous: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const user = await requirePermission(PERMISSIONS.AGENT_MANAGE);

  const parsed = agentIdSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await unlockAgent(parsed.data.agentId, user.id);
  } catch (error) {
    log.error({ err: error }, "Failed to unlock agent");
    return { error: "The account could not be unlocked. Try again." };
  }

  revalidatePath(`/admin/agents/${parsed.data.agentId}`);
  return { success: "Lockout cleared." };
}
