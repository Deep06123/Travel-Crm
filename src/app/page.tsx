import { redirect } from "next/navigation";

/**
 * Root route.
 *
 * The CRM itself lives under `/admin` and requires a sign-in, which needs a
 * seeded database. The interface showcase at `/demo.html` needs neither: it is
 * a single static file served straight from `public/`, with sample data baked
 * in and no server, database or session involved.
 *
 * Sending the root here means the deployment is viewable the moment it builds.
 * `/admin` still exists and still authenticates — nothing about the real
 * application's access control changes.
 */
export default function RootPage() {
  redirect("/demo.html");
}
