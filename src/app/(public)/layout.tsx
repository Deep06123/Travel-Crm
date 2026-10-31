/**
 * The only part of this application a customer ever sees.
 *
 * Everything else lives under `/admin` and is behind the session guard in
 * `src/proxy.ts`, whose matcher deliberately does not cover this group. A page
 * here is reachable by anyone holding the URL, so the authority is always the
 * token in the path — never a session, and never the absence of one.
 *
 * No admin shell, no navigation, no sign-out: there is nothing here to
 * navigate to, and a link back into the CRM would be an invitation to try.
 * `robots: { index: false }` on the root layout already keeps these pages out
 * of search results, which matters more here than anywhere else — a signing
 * link should not be findable by anyone it was not sent to.
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <div className="min-h-full bg-[#f2f5fa] text-[#252525]">{children}</div>;
}
