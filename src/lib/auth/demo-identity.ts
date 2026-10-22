/**
 * Identity of the demo administrator.
 *
 * Both halves are fixed rather than generated. A serverless deployment running
 * the embedded database gives every instance its own copy, so a row created
 * during one request does not exist for the next. Pinning the id means every
 * instance creates the *same* administrator at boot, and a reference written on
 * one instance still resolves on another.
 *
 * Kept in its own module because it is needed by the database bootstrap and by
 * the access layer, and importing either from the other would be circular.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so this
 * address cannot collide with a real person's or receive mail.
 */

/** Fixed so the account is identical on every instance. */
export const DEMO_ADMIN_ID = "demo0000000000000000000000";

export const DEMO_ADMIN_EMAIL = "demo@travel-crm.invalid";
