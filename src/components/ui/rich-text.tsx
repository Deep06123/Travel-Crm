import { sanitiseRichText } from "@/lib/html/sanitise";

import { cn } from "@/lib/utils";

/**
 * Renders itinerary markup composed in the rich-text editor.
 *
 * This is the one place in the application where stored markup is rendered as
 * markup rather than escaped, so it is sanitised again here. The value was
 * already cleaned when it was saved; cleaning it again on the way out means a
 * row written before the sanitiser existed — or by anything that bypasses the
 * create path — still cannot carry a script into an administrator's session.
 *
 * Nothing is rendered when the markup is empty, so callers can hand over a
 * nullable column directly and get no stray heading or spacing for a booking
 * that has no itinerary.
 */
export function RichText({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const clean = sanitiseRichText(html);
  if (!clean) return null;

  return (
    <div
      className={cn("prose-itinerary text-sm text-ink", className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
