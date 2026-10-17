"use client";

import { Lock, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Error boundary for the admin area.
 *
 * `ForbiddenError` from the access layer is presented as a permission message
 * rather than a crash. Next.js replaces the message of a server-thrown error
 * with a generic one in production, so the name is matched on the `digest`
 * marker the access layer sets, falling back to the message in development.
 *
 * No error detail is rendered beyond this: the stack and query context stay in
 * the server log.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console for local debugging; the real record is
    // already in the structured server log.
    console.error(error);
  }, [error]);

  const isForbidden =
    error.name === "ForbiddenError" ||
    error.message.includes("Missing required permission");

  if (isForbidden) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Lock className="mx-auto size-10 text-ink-subtle" />
        <h1 className="mt-4 text-lg font-semibold text-ink">
          You do not have access to this page
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your role does not include the permission this page requires. Ask a
          super administrator if you need it.
        </p>
        <Link href="/admin" className={`${buttonVariants()} mt-5`}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <TriangleAlert className="mx-auto size-10 text-status-danger" />
      <h1 className="mt-4 text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-1 text-sm text-ink-muted">
        The page could not be loaded. The error has been logged.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Button onClick={reset}>
          <RefreshCw />
          Try again
        </Button>
        <Link href="/admin" className={buttonVariants({ variant: "secondary" })}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
