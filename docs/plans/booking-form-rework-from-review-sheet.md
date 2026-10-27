# Plan — Flight and cruise form rework, from the review sheet

Source: the review sheet image supplied 2026-10-28. Four ambiguous rows were settled with the
user before planning; their answers are recorded in §0.

## 0. Decisions already taken

| Row | Decision |
| --- | --- |
| "Initial status → charged / decline / chargeback / pending" | **New field.** `BookingStatus` (Draft→Pending→Confirmed→Ticketed→Completed) keeps driving ticketing, emails, filters and the audit history untouched. The four values become a separate charge outcome shown where *Initial status* is now. |
| "Customer column → not needed" | **Contact fields go, selector stays.** `Booking.customerId` is a required FK with `onDelete: Restrict`; a customer-less booking would break the customer detail page, customer emails and the export. Contact name / email / phone are dropped (billing already holds a phone and an email list); the customer dropdown moves into *Booking details*. |
| "Flight segment auto-filled on pasting the screenshot" | **Deferred.** OCR plus a segment parser is its own piece of work and reverses the documented rule that pasted text is stored verbatim and never parsed. Nothing else in the sheet depends on it. |
| "Priority auto set … nearest to farthest date" | **Derived, input removed.** Computed from days until travel on write: ≤7 Urgent, ≤30 High, ≤90 Normal, beyond that Low. No travel date → Normal. |

## 1. Standing rule for the removals

Every "removed" / "not needed" row takes the **input off the form** and leaves the **database
column in place**. All of them are already nullable and all hold data in existing bookings;
dropping the columns would destroy that data for no gain, and re-adding a field later becomes a
label change rather than a migration. Removed values simply stop being collected on new bookings.

Two columns are the exception, because they do not exist yet and must be added: the charge
outcome, and nothing else.

## 2. Row-by-row

### Both forms

| Sheet row | Change |
| --- | --- |
| Customer email subject → "SUBJECT" | Relabel the `customEmailSubject` field to **Subject** on both forms. Name and behaviour unchanged. |
| Email top heading → removed | Drop the `emailTopHeading` input from both. The template falls back to its own heading, which is what a blank value already meant. |
| Booking Source → removed | Drop the `source` input from both. |
| Priority → auto | Remove the select. A new `derivePriority(travelStartDate, now)` helper in the booking service sets the stored value on create. |
| Initial status → charged / decline / chargeback / pending | Replace the *Initial status* select with **Charge outcome**: Pending (default), Charged, Declined, Chargeback. `BookingStatus` is no longer chosen by the agent — a new booking is created as `PENDING`, as the status service already expects. |
| Customer column | Remove Contact name / Email / Phone. Move the customer dropdown into *Booking details*. On the cruise form, *Cruise line confirmation* (`confirmationReference`) moves up into *Cruise information* — it is reservation data that happens to sit in that panel. |
| Accounting → 5 columns | Keep exactly five inputs, in this order: **Gross fare** (`baseFare`; labelled *Cruise fare* on the cruise form), **MCO** (`grossMco`), **Total fare** (`total`), **MCO supplier** (`mcoSupplierId`), **Split charges** (`splitCharges`). Dropped from the form: Currency, Taxes and fees, Supplier cost, Net MCO, MCO status, Financial notes. Currency becomes a hidden input carrying the operator default, because the service needs it to convert the amounts to minor units. |
| Comments → notes only | Panel renamed **Notes**, holding the single `comment` field relabelled *Notes*. The *Follow-up date* input goes. |

### Cruise only

| Sheet row | Change |
| --- | --- |
| Booking type → add Gratuities, Add or Remove Guest, Name change | Three new `BookingType` rows seeded with `product: CRUISE`. Both new-booking pages currently list every active type regardless of product, so they also gain a filter: types matching the page's product, plus those with no product set. |
| Departure / Arrival port → Departure date and return date | Remove the two port inputs. Relabel *Sail date* → **Departure date** and keep *Return date*. |
| Supplier → not needed | Remove the supplier select. |
| Itinerary and reservation text → just itinerary | Remove the whole `ItinerarySource` block — the pasted reservation text and the rich-text editor both — leaving the plain **Itinerary** textarea. |
| Special assistance → removed | Remove the `assistanceNotes` input. |

### Flight only

| Sheet row | Change |
| --- | --- |
| Flight Information → auto-fill from screenshot | Deferred per §0. No change this round. |

## 3. Schema change

One addition only:

```prisma
enum ChargeOutcome {
  PENDING
  CHARGED
  DECLINED
  CHARGEBACK
}
```

plus `chargeOutcome ChargeOutcome @default(PENDING)` on `Booking`. The name avoids `PaymentStatus`,
which the `Payment` model already owns with different values. Migration is one `ADD COLUMN` with a
default, so existing rows land on `PENDING`.

## 4. Files

| # | File | Change |
| --- | --- | --- |
| 1 | `prisma/schema.prisma` | `ChargeOutcome` enum, `Booking.chargeOutcome` |
| 2 | `prisma/migrations/<ts>_booking_charge_outcome/` | one `ADD COLUMN … DEFAULT 'PENDING'` |
| 3 | `prisma/seed.ts` | three cruise booking types (`GRATUITIES`, `GUEST_ADD_REMOVE`, `NAME_CHANGE`), sort order 60–80, `product: CRUISE` |
| 4 | `src/features/bookings/schemas.ts` | drop `status` from the input, add `chargeOutcome`, drop `priority` (derived server-side); keep every other field so existing data and the service keep working |
| 5 | `src/features/bookings/cruise-schemas.ts` | same |
| 6 | `src/features/bookings/flight-booking-form.tsx` | all form changes above |
| 7 | `src/features/bookings/cruise-booking-form.tsx` | all form changes above |
| 8 | `src/server/services/booking-service.ts` | `derivePriority()`; set `priority` and `status: PENDING` server-side; persist `chargeOutcome` on both create paths |
| 9 | `src/app/admin/(dashboard)/bookings/new/{flight,cruise}/page.tsx` | product-filter the booking types |
| 10 | `src/app/admin/(dashboard)/bookings/[id]/page.tsx` | show Charge outcome; the removed inputs still render when an older booking holds a value |
| 11 | `tests/unit/` | new `derive-priority.test.ts` covering each threshold and the no-date case |
| 12 | `tests/integration/{flight,cruise}-bookings.test.ts` | update fixtures that pass `status`/`priority`; assert the derived priority and the stored charge outcome |

## 5. Risks to raise with the user

1. **Derived priority goes stale.** Priority is computed on write, but there is no booking edit
   path, so a booking created 120 days out stays *Low* for ever and never climbs as the sail date
   approaches — which is exactly what `/admin/high-priority` reads. A nightly recompute job is the
   fix; it is not in this plan.
2. **Removing the cruise ports costs the authorisation document.** The document completed
   yesterday prints "from Galveston, Texas" and "to Galveston, Texas". Those come from
   `departurePort` / `arrivalPort`, which this sheet removes from the form. Existing bookings keep
   their values; new ones will have none.
3. **Removing the reservation text and rich itinerary** drops the two fields added in the
   25 Oct migrations, including the sanitised HTML the authorisation email was meant to use.
4. **Currency stops being selectable** even though the operator setting allows several. Every new
   booking takes the default. Say the word and I will leave the select in as a sixth input.
5. **Two sheet rows are cut off** at the right edge of the image — the accounting rows end at
   "SPLIT CHARG…" and the cruise information row at "Departure date and return…". I read them as
   *Split charges* and *return date*. Worth confirming.

## 6. Verification

- `npx prisma migrate deploy`, then `migrate status` reports no drift.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` (with `STORAGE_DRIVER=local`) clean.
- Full `vitest` run green, including the updated booking fixtures.
- Manual: create one flight and one cruise booking, confirm the form shows only the fields the
  sheet keeps, and that priority and charge outcome land correctly on the detail page.
