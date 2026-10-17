import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <FileQuestion className="mx-auto size-10 text-ink-subtle" />
      <h1 className="mt-4 text-lg font-semibold text-ink">Not found</h1>
      <p className="mt-1 text-sm text-ink-muted">
        This record does not exist, or it has been removed.
      </p>
      <Link href="/admin" className={`${buttonVariants()} mt-5`}>
        Back to dashboard
      </Link>
    </div>
  );
}
