import "server-only";

import sanitizeHtml from "sanitize-html";

import { isInlineImageSrc } from "./inline-image";

/**
 * Cleans HTML composed in the rich-text editor before it is stored.
 *
 * The itinerary editor is the one place in this application where a user's
 * markup is kept as markup rather than escaped. Everything else — booking
 * fields, comments, the customer emails — is escaped at render, which is why
 * none of it can carry a script. Markup that will later be rendered as markup
 * has to be made safe at the point it is accepted instead.
 *
 * Sanitising on the server, not in the browser: the editor's own output is
 * irrelevant, because an action is reachable with any body an attacker cares
 * to send. A booking holds passport numbers and payment references, and an
 * administrator viewing a crafted itinerary would run that script with their
 * own session on this origin.
 *
 * The allowed set is deliberately small — the formatting an itinerary needs
 * and nothing else. Notably absent:
 *
 *   * `script`, `style`, `iframe`, `object`, `embed`, `form` — execution and
 *     exfiltration.
 *   * every `on*` attribute, which is where most injected script actually
 *     lives; `sanitize-html` drops any attribute not named below.
 *   * `img`, despite the reference toolbar offering it. A remote image is a
 *     silent callback to whoever supplied the URL, telling them when the
 *     booking was opened and from where. Re-enable it alongside an upload
 *     path that stores the bytes locally.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "sub",
    "sup",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "span",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
    "img",
    "figure",
    "figcaption",
  ],

  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    // No `srcset`, `loading` or `referrerpolicy`: `srcset` is a second place a
    // URL can hide, and the rest are not worth the surface.
    img: ["src", "alt", "width", "height"],
    // Alignment and emphasis survive; anything else in a style attribute does
    // not. `style` is filtered further by `allowedStyles` below.
    "*": ["style"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },

  // A URL scheme is an execution vector: `javascript:` and `data:` both run or
  // embed content. Only the three that address a document are permitted.
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,

  // Inline styles are matched against these patterns; anything else is
  // dropped. `position`, `url(...)` and `expression(...)` therefore cannot
  // survive, so the markup cannot escape its container or fetch anything.
  allowedStyles: {
    "*": {
      "text-align": [/^left$|^right$|^center$|^justify$/],
      "font-weight": [/^bold$|^normal$|^[1-9]00$/],
      "font-style": [/^italic$|^normal$/],
      "text-decoration": [/^underline$|^line-through$|^none$/],
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      "background-color": [
        /^#[0-9a-fA-F]{3,8}$/,
        /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/,
      ],
    },
  },

  // Applied after the attribute filter. `sanitize-html` drops the whole tag
  // when this returns an empty string for `src`, which is the outcome wanted:
  // a remote image leaves nothing behind rather than a broken placeholder.
  exclusiveFilter: (frame) =>
    frame.tag === "img" && !isInlineImageSrc(frame.attribs["src"] ?? ""),

  transformTags: {
    // A link that opens a new tab gives the opened page a handle on this one
    // via `window.opener` unless told otherwise. Forced rather than trusted,
    // because the submitted markup decides nothing here.
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },

  // Dropped outright, contents and all. Without this the text inside a
  // `<script>` would survive as plain text, which reads as corruption.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
};

/**
 * Returns sanitised HTML, or null when nothing meaningful remains.
 *
 * An editor left untouched still submits something — `<p></p>` or a bare
 * `<br>`. Storing that would make an empty field look filled, so it is
 * normalised to null, the same value an absent field has.
 */
export function sanitiseRichText(input: string | null | undefined): string | null {
  if (!input) return null;

  const clean = sanitizeHtml(input, OPTIONS).trim();

  // An image is content even with no text beside it: an itinerary that is just
  // a screenshot of the carrier's confirmation is a normal thing to store, and
  // a text-only emptiness test would throw it away.
  if (clean.includes("<img")) return clean;

  // Tag-only markup carries no content.
  if (clean.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim() === "") {
    return null;
  }

  return clean;
}
