import { redirect } from "next/navigation";

/** This deployment is admin-only; there is no public surface. */
export default function RootPage() {
  redirect("/admin");
}
