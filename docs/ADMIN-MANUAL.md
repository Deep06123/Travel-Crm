# Travel CRM — Admin Manual

A short guide to using the system day to day. No technical knowledge needed.

---

## 1. Signing in

1. Go to your CRM address (locally: `http://localhost:3000`).
2. Enter your **email or username** and your **password**.
3. Click **Sign in**.

**First time?** You will be asked to set a new password straight away. This is
normal — the password you were given is temporary.

**Forgot your password?** Nobody can look it up for you, not even a super
administrator. Ask your administrator to reset it; you will get a new temporary
one.

**Locked out?** Too many wrong passwords locks the account for a while. How many
attempts and how long the lock lasts are set per installation — ask your
administrator, who can also unlock you straight away.

You are signed out automatically after a period of inactivity, also set per
installation.

---

## 2. Finding your way around

Everything is in the left sidebar, grouped by job:

| Group | What's in it |
|---|---|
| **Dashboard** | Today's numbers at a glance |
| **Bookings** | All bookings, create new, high priority, refunds |
| **Customers** | Customer list, comments, service cases, calls |
| **Finance** | Payments, chargebacks, documents |
| **Reports** | Bookings, financial, agent and supplier performance |
| **Messaging** | Inbox, compose, sent, groups, notifications |
| **Administration** | Agents, suppliers, TFN numbers, settings, audit logs |

You only see what your role allows. If a menu item is missing, you don't have
permission for it — that's not a fault.

---

## 3. Customers

### Add a customer

1. **Customers → Customers → New customer**
2. Fill in the name (required) and whatever else you have: email, phone,
   billing address.
3. Click **Save**.

The system gives each customer a reference like `CUS-100042` automatically.

### Duplicate warning

If the email or phone matches an existing customer, you will see a warning
before saving. Check it — you are probably looking at a customer who already
exists. A matching *name alone* is not treated as a duplicate, because names
repeat.

### Edit or view

Click any customer in the list to see their bookings, payments, notes and
service history. Use **Edit** to change their details.

---

## 4. Bookings

### Create a booking

Choose the right type from the sidebar — **Create Flight Booking** or
**Create Cruise Booking**. (The bookings list also has **New flight** and
**New cruise** buttons at the top.)

Then:

1. Pick the **customer** (create them first if they're new).
2. Fill in the travel details — airline, route and dates, or cruise line, ship
   and sailing dates.
3. Add **passengers**. At least one is needed before the booking can be
   confirmed.
4. Enter the **money**: base fare, taxes and fees, and what the supplier
   charges you.
5. Save.

The booking gets a number like `MV70056` automatically.

### Booking stages

A booking moves through these stages:

**Draft → Pending → Confirmed → Ticketed → Completed**

(or **Cancelled** at any point)

**Needs Review** is for bookings that need a second look before going further.

### Moving a booking forward

Open the booking and use the status control. The system will stop you if
something is missing:

**To mark Confirmed you need:**
- An airline or supplier confirmation reference
- At least one passenger

**To mark Ticketed you need:**
- Ticket status set to *Issued*
- A ticket number on at least one passenger
- An airline or supplier confirmation reference

This is deliberate. A booking should never say "ticketed" unless a ticket
actually exists.

### Cancelling

Cancelling asks for a **written reason** and a typed confirmation. The reason is
kept permanently. Cancelling does **not** automatically void a ticket or issue a
refund — those are separate actions.

### Comments and follow-ups

On each booking you can:

- Add a **comment** — internal, or marked customer-facing
- Set a **follow-up** with a due date and an assignee

Overdue follow-ups appear on the dashboard and under **High Priority**.

---

## 5. Payments

**Finance → Payments**

### Record a payment

1. Open the booking, or go to Payments.
2. Click **Record payment**.
3. Enter the amount, currency and method (card, bank transfer, cash, MCO…).
4. Save.

A payment you type in is labelled **Manually recorded**. This means *you* are
saying the money arrived — the system has not verified it with a card provider.
That label is always shown and cannot be removed. Don't treat it as proof of
payment.

### Reconciliation

Each payment is Unreconciled, Matched, Disputed or Written off. Update this as
you check payments against your bank statement.

---

## 6. Refunds and voids

**Bookings → Refund & Void**

- A **refund** returns money that has already settled.
- A **void** cancels a charge that hasn't settled yet.

### How it works

1. **Request** the refund — amount and reason.
2. Someone **else** approves it. You cannot approve your own request.
3. Large refunds (above the configured threshold) need a **super
   administrator**.
4. Once processed, mark it **Completed**.

The system will not let you refund more than the booking actually collected,
and it counts refunds already in progress so the same money can't go out twice.

---

## 7. Chargebacks

**Finance → Chargebacks**

When a customer disputes a charge with their bank:

1. Record the chargeback with the amount, reason code and the bank's
   **respond-by date**.
2. Attach evidence documents.
3. Update the outcome: Won, Lost or Accepted.

Deadlines are shown prominently — missing one usually means losing the dispute
automatically.

---

## 8. Documents

**Finance → Documents**

Upload confirmations, e-tickets, invoices, receipts and evidence files. Attach
them to a booking or a customer.

- Files are stored privately. There is no public link.
- Uploading a new version keeps the old one.
- Mark documents **Verified** once you've checked them.

Documents the system generates itself are labelled *Internally generated* so
they're never mistaken for an airline's own paperwork.

---

## 9. Customer service and calls

**Customers → Customer Service** — open a case for a complaint or request. Set a
priority, assign an owner, record the resolution.

**Customers → Call Management** — log calls: who, when, inbound or outbound, the
outcome, and whether a callback is needed.

Calls are logged by hand. The system does not record or dial calls.

---

## 10. Messaging and email

There are two separate things here. Don't confuse them.

### Internal messages (staff to staff)

**Messaging → Compose** — write to colleagues or a group.
**Messaging → Inbox / Sent** — read and review.
**Messaging → Groups** — create groups like "Air desk" or "Finance" so you can
message several people at once.

These stay inside the CRM. They are not emails to customers.

### Customer emails

Customer emails are sent **automatically**, not written by hand. An email goes
out when a booking is:

- marked **Confirmed** → booking confirmation
- marked **Ticketed** → ticket details

**Messaging → Notifications** shows every email the system owed, with its
status:

| Status | Meaning |
|---|---|
| Sent | Handed to the mail provider |
| Delivered | Provider confirmed delivery |
| Failed | Could not be sent — reason shown |
| **Suppressed** | **Not sent at all** |

**Suppressed** usually means one of two things: the booking has no contact email
address, or email sending is not switched on for this installation. Either way
the customer did *not* receive anything. Check this page if someone says they
never got their confirmation.

If every notification says Suppressed, email is switched off — ask whoever
manages the system to configure it.

---

## 11. Reports

All reports take a date range.

- **Booking Report** — counts by status, product, type, agent and supplier
- **Financial Report** — money charged, collected, refunded, supplier costs
- **Agent Performance** — bookings created, assigned, ticketed, cancelled
- **Supplier Performance** — volume and MCO figures per supplier

Money is always shown **per currency** and never added across currencies, since
there is no exchange rate configured.

The bookings list has an **Export CSV** button. The file contains exactly what
your current filter shows, not the whole table.

---

## 12. Administration

Only for super administrators and senior staff.

### Agents

**Administration → Agents** — add staff, set their role, reset passwords, unlock
accounts, and deactivate people who leave.

You can never see anyone's password. Resetting generates a new temporary one
shown **once** — copy it before closing the screen.

### Suppliers, MCO Suppliers, TFN

Reference lists you maintain yourself:

- **Suppliers** — airlines, cruise lines, consolidators
- **MCO Suppliers** — who you settle MCO balances with
- **TFN Management** — your toll-free numbers

Mark entries inactive rather than deleting them, so old bookings keep their
history.

### Settings

**Administration → Settings** shows:

- **Business settings** — supported currencies, refund approval threshold, etc.
- **Booking types** — your own categories (New Booking, Re-Booking, Changes…)
- **Fixed vocabularies** — the booking and refund stages, shown for reference.
  These cannot be edited, because reports and rules depend on them.

### Audit logs

**Administration → Audit Logs** — a permanent record of who did what and when.
Entries are never edited or deleted. Use it to answer "who cancelled this?" or
"who approved that refund?".

---

## 13. Who can do what

| Role | Can do |
|---|---|
| **Super Admin** | Everything, including large refund approvals and settings |
| **Operations** | Bookings, customers, documents, day-to-day work |
| **Finance** | Payments, refunds, chargebacks, financial reports |
| **Support** | Customer service cases, calls, comments |
| **Read Only** | View only — cannot change anything |

If you try something outside your role you'll get a clear "not permitted"
message. Ask a super administrator if you need access.

---

## 14. Common problems

**"The service is temporarily unavailable"**
The database can't be reached. Not your fault, and nothing you typed was saved.
Wait a moment and try again; tell your administrator if it continues.

**I can't confirm or ticket a booking**
The message lists exactly what's missing. Add it, then try again.

**I can't approve a refund**
Either you requested it yourself — someone else must approve — or it's above the
threshold and needs a super administrator.

**A customer says they never got their email**
Check **Messaging → Notifications**. If it says Suppressed, no email was sent;
see section 10.

**A menu item is missing**
Your role doesn't include it.

---

## Good habits

- Write real reasons when cancelling or refunding. Someone will read them later.
- Record payments as they arrive, not in a weekly batch.
- Keep follow-ups honest — mark them done when they're done.
- Deactivate staff the day they leave, don't delete them. Their history matters.
