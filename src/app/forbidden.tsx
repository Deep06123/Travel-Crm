import { Lock } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/**
 * Rendered when a page calls `forbidden()`.
 *
 * Carries a 403 status, so a permission denial is distinguishable from a
 * server fault both to the browser and to monitoring.
 */
export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="max-w-md text-center">
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
    </div>
  );
}
