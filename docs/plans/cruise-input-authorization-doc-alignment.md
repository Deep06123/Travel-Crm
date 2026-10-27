# Plan — Align the cruise input with the Cruise Authorization document

Reference: `Professional_Cruise_Authorization_Email.docx` (Skyhyplanners / Carnival Miracle,
confirmation QK43F0). Scope confirmed with the user: **cruise booking input only** — schema,
form, persistence and the booking detail view. The email template is out of scope.

## 1. Document → field audit

Every row of the document mapped to what the cruise input holds today.

### §1 Cruise Reservation Details

| Document row | Today | Verdict |
| --- | --- | --- |
| Cruise Line — *Carnival Cruises* | `cruiseLine` | covered |
| Confirmation Number — *QK43F0* | `reservationNumber` | covered |
| Ship Name — *Carnival Miracle* | `ship` | covered |
| Number of Nights — *10 Night Western Caribbean from Galveston Cruise* | `nights` (integer only) | **gap** — the document prints a sailing title, not a number |
| Departure Date — *Mon, Nov 23 2026 from Galveston, Texas* | `sailDate` + `departurePort` | covered |
| Return Date — *Thu, Dec 3 2026 to Galveston, Texas* | `returnDate` + `arrivalPort` | covered |
| Number of Guests / Rooms — *2 Guest / Interior* | guest repeater + `cabinCategory` | covered |
| Deck / Room Number — *Deck 08 / Room number: 8103* | `cabinNumber` only | **gap** — no deck |
| Contact Phone Number — *4077707556* | `contactPhone` | covered |
| Special Request — *Name Change* | — (`assistanceNotes` is special *assistance*, a different thing) | **gap** |

### §2 Guest Information

| Document element | Today | Verdict |
| --- | --- | --- |
| Guest Name | `guests[].firstName/lastName` | covered |
| Gender — *Female / Male* | `gender` exists in `cruiseGuestSchema` and persists to `Passenger.gender`, but the cruise form never renders an input for it | **gap** — field is unreachable from the UI |
| Date of Birth | `guests[].dateOfBirth` | covered |
| **Old Guest name** vs **New Guest Name** tables | — | **gap** — no way to record the prior name a name-change request is replacing |

### §3 Payment Authorization

Cardholder Name → `cardHolderName`; Card Type → `cardType`; masked Card Number → `cardLast4`;
Grand Total → `total`. All covered by `billingInformationFields`. **No change.**

### §4 Charges & Balance Summary

The one line, *"Carnival Cruise line – via Skyhyplanners — $300.00"*, is the supplier label plus
the booking total, both of which already exist (`supplierId`, `total`). **No change** — adding a
charge line-item model would exceed "only what the document shows".

### §5 Itinerary & Terms

Itinerary details → `itineraryHtml` / `itinerary`. The terms URL is fixed company text, not
per-booking input. **No change.**

### §6 Acknowledgment / footer

Static copy; agent name → `assignedAgentId`, toll-free → `tfnId`. **No change.**

## 2. Changes to make

Four gaps, no more.

1. **`sailingName`** — free-text sailing/package title (e.g. *10 Night Western Caribbean from
   Galveston Cruise*). `nights` stays as the numeric field; this is the printed description.
2. **`deckNumber`** — free text (*Deck 08*), sits beside `cabinNumber`.
3. **`specialRequest`** — free text (*Name Change*), distinct from `assistanceNotes`.
4. **Guest name-change support** —
   - render the existing **Gender** select in the cruise guest repeater (mirror
     `flight-booking-form.tsx:363`, same four options);
   - add **`previousFirstName`** / **`previousLastName`** per guest, so the document's
     *Old Guest name* table can be produced from the record. Left blank for an ordinary booking.

## 3. Files, in order of change

| # | File | Change |
| --- | --- | --- |
| 1 | `prisma/schema.prisma` | `CruiseDetail`: `sailingName String?`, `deckNumber String?`, `specialRequest String? @db.Text`. `Passenger`: `previousFirstName String?`, `previousLastName String?` |
| 2 | `prisma/migrations/<ts>_cruise_authorization_fields/` | new migration; all columns nullable, so no backfill and no data loss |
| 3 | `src/features/bookings/cruise-schemas.ts` | `sailingName: optionalText(200)`, `deckNumber: optionalText(40)`, `specialRequest: optionalText(500)` on `cruiseBookingSchema`; `previousFirstName` / `previousLastName: optionalText(100)` on `cruiseGuestSchema` |
| 4 | `src/features/bookings/cruise-booking-form.tsx` | *Cruise information*: `sailingName` (full-width, next to Nights), `specialRequest`. *Cabin and dining*: `deckNumber` before `cabinNumber`. *Guests*: Gender select + the two previous-name inputs, hinted "only for a name-change request" |
| 5 | `src/server/services/booking-service.ts` (~685, ~702) | carry the three cruise fields into `cruiseDetail.create` and the two name fields into `passengers.create`, following the existing `?? null` style |
| 6 | `src/app/admin/(dashboard)/bookings/[id]/page.tsx` (~380-420) | `DetailRow`s for Sailing, Deck and Special request; previous name shown on a guest row only when present |
| 7 | `src/lib/db/sample-dataset.ts` | populate the new fields on seeded cruise bookings so the demo mirrors the document |
| 8 | `tests/integration/cruise-bookings.test.ts` | extend the create case to submit and assert the five new values, including a guest carrying a previous name |

Regenerating the Prisma client (`src/generated/prisma`) happens as part of step 2.

## 4. Deliberately not doing

- No charge line-item table (§4 is satisfied by supplier + total).
- No change to the payment panel (§3 is fully covered).
- No email template work — out of scope per the user.
- `confirmationReference` and `reservationNumber` overlap, but the document shows one
  confirmation number and both already exist; leaving the duplication alone.

## 5. Verification

- `npx prisma migrate dev` applies cleanly against MySQL.
- `npm run lint` and `npx tsc --noEmit` clean.
- `npx vitest run tests/integration/cruise-bookings.test.ts` green.
- Manual pass: create a cruise booking entering every value from the document and confirm each
  one reads back on the booking detail page.
