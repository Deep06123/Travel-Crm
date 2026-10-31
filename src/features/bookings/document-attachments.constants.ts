/**
 * Names shared between the booking form and the actions that read it.
 *
 * Kept apart from `document-attachments.ts`, which is `server-only`: the form
 * is a client component and importing the server module for a string would
 * fail the build.
 */

/** The file input's name. */
export const BOOKING_DOCUMENTS_FIELD = "documents";

/** Query flag the booking page reads to warn that an attachment was lost. */
export const DOCUMENTS_FAILED_PARAM = "documentsFailed";
