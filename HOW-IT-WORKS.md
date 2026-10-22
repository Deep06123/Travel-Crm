# How This Website Works — A Simple Guide

*Written in plain, easy words. If you can read a school textbook, you can read this.*

---

## Table of contents

1. [What is this website?](#1-what-is-this-website)
2. [Who uses it?](#2-who-uses-it)
3. [The big idea in one picture](#3-the-big-idea-in-one-picture)
4. [What the screen looks like](#4-what-the-screen-looks-like)
5. [Getting in — the Login page](#5-getting-in--the-login-page)
6. [The Dashboard — the main screen](#6-the-dashboard--the-main-screen)
7. [Bookings — the heart of the website](#7-bookings--the-heart-of-the-website)
8. [Customers](#8-customers)
9. [Money: Payments, Refunds, Chargebacks](#9-money-payments-refunds-chargebacks)
10. [Documents](#10-documents)
11. [Daily work screens](#11-daily-work-screens)
12. [Messages and Notifications](#12-messages-and-notifications)
13. [Reports](#13-reports)
14. [Administration screens](#14-administration-screens)
15. [The rules that keep the website honest](#15-the-rules-that-keep-the-website-honest)
16. [How the code is arranged](#16-how-the-code-is-arranged)
17. [Words you will keep seeing](#17-words-you-will-keep-seeing)
18. [What is finished and what is left](#18-what-is-finished-and-what-is-left)

---

## 1. What is this website?

Imagine a travel agency. People call them and say:

> "I want to fly from Delhi to Dubai next month."
> "I want to book a cruise ship holiday for my family."

The travel agency staff book those tickets. But booking a ticket is only the
beginning. After that the agency must also:

- remember **who** the customer is,
- remember **what** they booked,
- collect **money** from them,
- sometimes give money **back**,
- keep the **passport copies and tickets** safe,
- call the customer back when something goes wrong,
- and at the end of the month, count **how much money the business made**.

If you try to do all of that with paper files and WhatsApp, you will lose
things. So this website was built. It is a big, organised digital register for
the travel agency.

The proper name for this kind of software is a **CRM** — *Customer Relationship
Management* system. Think of it as the agency's **"everything book."**

**Very important:** this is **not** a website where customers buy tickets.
Customers never see it. Only the agency's own staff log in. That is why every
single page address starts with `/admin`.

---

## 2. Who uses it?

Five kinds of staff use it. The website gives each of them a different amount
of power. This is like a school, where a student, a class teacher, the
accountant and the principal can each do different things.

| Role | Who they are | What they can do |
|---|---|---|
| **SUPER_ADMIN** | The boss / owner | **Everything.** Can also create staff accounts and change the rules. |
| **OPERATIONS** | The booking team | Create and edit bookings, add customers, upload documents, handle follow-ups. Can *see* money but cannot *touch* it. |
| **FINANCE** | The accounts team | Record payments, approve refunds, fight chargebacks, see all money reports. Cannot create bookings. |
| **SUPPORT** | The helpdesk team | Answer customer problems, log phone calls, add notes. Can look at money but not change it. |
| **READ_ONLY** | A trainee or an auditor | Can **look** at things. Cannot change anything at all. |

### How the power is actually decided

The role name (like "FINANCE") is only a **label**. The real power comes from a
list of small permission tickets, such as:

- `booking.view` — allowed to see bookings
- `booking.create` — allowed to make a new booking
- `refund.approve` — allowed to say "yes" to a refund
- `passenger.viewSensitive` — allowed to see passport numbers

There are about **60** such tickets. Each role simply holds a bundle of them.
This is better than fixed roles, because the boss can later say *"give the
Support team the power to log calls too"* without any programmer rewriting the
software.

---

## 3. The big idea in one picture

```
        A customer phones the agency
                    |
                    v
   Staff member logs in  ──────────>  LOGIN PAGE
                    |
                    v
        Creates a CUSTOMER record      (who is this person?)
                    |
                    v
        Creates a BOOKING              (flight or cruise?)
                    |
          +---------+---------+
          |                   |
          v                   v
     PASSENGERS          ITINERARY / SAILING
     (who travels)       (where and when)
                    |
                    v
          Booking moves through STATUSES
       Draft -> Pending -> Confirmed -> Ticketed -> Completed
                    |
          +---------+---------+---------+
          |         |         |         |
          v         v         v         v
      PAYMENTS   REFUNDS  DOCUMENTS  COMMENTS
      (money in) (money    (tickets,  & FOLLOW-UPS
                  out)      passports) (reminders)
                    |
                    v
             REPORTS at month end
         (how did the business do?)
```

Everything in the website hangs off one thing: the **booking**.

---

## 4. What the screen looks like

Every page after login has the same shape:

```
+-----------------+-----------------------------------------------+
|                 |  Breadcrumb trail          [ Your name ] [->] |
|   SIDEBAR       +-----------------------------------------------+
|   (the menu)    |                                               |
|                 |   PAGE TITLE                                  |
|  Dashboard      |   a short grey line explaining the page       |
|                 |                                               |
|  BOOKINGS       |   +---------------------------------------+   |
|   All Bookings  |   |  Filter boxes:  [search] [status] [Go]|   |
|   New Flight    |   +---------------------------------------+   |
|   New Cruise    |                                               |
|   High Priority |   +---------------------------------------+   |
|   Refund & Void |   |  A TABLE of rows                      |   |
|                 |   |  ...                                  |   |
|  CUSTOMERS      |   |  ...                                  |   |
|   Customers     |   +---------------------------------------+   |
|   Comments      |                                               |
|   Cust. Service |   < Previous    Page 1 of 12    Next >        |
|   Call Mgmt.    |                                               |
|                 |                                               |
|  FINANCE        |                                               |
|  REPORTS        |                                               |
|  MESSAGING      |                                               |
|  ADMINISTRATION |                                               |
+-----------------+-----------------------------------------------+
```

**The sidebar** on the left is the menu. It has **7 groups**: Dashboard,
Bookings, Customers, Finance, Reports, Messaging and Administration — 24 links
in total.

A clever detail: **the sidebar only shows links you are allowed to use.** If
you are from the Support team, you simply will not see the "Settings" link at
all. It is not greyed out — it is just not there. Your menu is shorter and
simpler than the boss's menu.

> ⚠️ But hiding a link is only being *polite*. It is **not** the real lock. Even
> if you typed the secret address into the browser by hand, the page itself
> would check your permission again and refuse you. The hidden link is a
> curtain; the real lock is on the door behind it. (More on this in section 15.)

**Most list pages follow the same recipe**, so once you learn one you know them
all:

1. A **title** with a count — "All bookings · 1,284 bookings".
2. A **filter bar** — type a name, pick a status, pick dates, press Apply.
3. A **table** of results with coloured badges.
4. **Page numbers** at the bottom (the table never dumps 10,000 rows at once).
5. Sometimes an **Export CSV** button to open the data in Excel.

---

## 5. Getting in — the Login page

**Address:** `/admin/login`

A simple box: email (or username) and password. Press sign in.

What happens behind the curtain:

- Your password is **never** stored as real text. The computer stores a
  scrambled fingerprint of it (called a *bcrypt hash*).ot Even the boss cann
  read your password. If you forget it, nobody can tell you what it was — you
  can only be given a brand-new one.
- **Wrong password too many times? The account locks itself** for a while. This
  stops a thief from guessing passwords one after another, forever.
- Every sign-in attempt — good or bad — is written down with the time and the
  computer's IP address.

### The forced password change

**Address:** `/admin/change-password`

When a brand-new staff member logs in for the very first time, the website
**refuses to let them anywhere else** until they pick their own password. Their
account carries a little flag called `mustChangePassword`. Until that flag is
cleared, every road leads back to this one page.

### Your session

Once you are in, the website gives your browser a small secret ticket called a
**session cookie**. On every page you visit, the website checks that ticket
against its own records in the database.

This matters a lot. Many websites use a "stateless" ticket that works until it
expires — which means if the boss fires someone at 10 a.m., that person might
still get in until 6 p.m. **Here, the check happens against the live database
every single time.** So the moment an account is suspended or its password is
changed, that person is thrown out *instantly*. And even the stored ticket is
only kept as a scrambled fingerprint, never the real thing.

---

## 6. The Dashboard — the main screen

**Address:** `/admin`

This is the first thing you see after logging in. It is the **"how is the
business doing today?"** screen. Think of it as the dashboard of a car: speed,
fuel and warning lights, all in one glance.

At the very top is a **date picker**: *From* and *To*. By default it shows the
**last 30 days**. Change the dates and press Apply, and the whole page recounts
itself for that period.

### Row 1 — Six booking counters

Six coloured boxes, each one clickable (clicking jumps to the matching filtered
list):

| Box | Colour | Meaning |
|---|---|---|
| **Bookings** | blue | New bookings in this date range (with the all-time total underneath) |
| **Pending** | orange | Started but not yet confirmed |
| **Needs review** | orange | Something is wrong — a human must look |
| **Confirmed** | green | The airline/cruise line said yes |
| **Ticketed** | green | The actual ticket has been issued |
| **Cancelled** | red | Called off |

### Row 2 — Five money boxes

*(Only visible if your role is allowed to see money.)*

| Box | Meaning in plain words |
|---|---|
| **Gross booking value** | What customers **promised** to pay us |
| **Payments collected** | What has **actually arrived** in our account |
| **Refunds issued** | What we have **actually given back** |
| **Net collections** | Collected **minus** refunded — the real money we kept |
| **Gross / net MCO** | Supplier settlement amounts |

This separation is deliberate and it is one of the smartest things in the whole
project. A promise is not money. Money is money. The website never mixes the
two up.

> **A neat touch:** if the agency deals in dollars *and* rupees, the dashboard
> shows them **side by side** — `$5,000 · ₹80,000` — and never adds them into
> one fake number. Adding two currencies without an exchange rate produces a
> meaningless total, so the code literally **refuses** to do it and throws an
> error instead.

### Row 3 — Two charts

- **Booking trend** — a line graph showing bookings day by day. Is the business
  going up or down?
- **Status distribution** — a pie-style chart showing how bookings are split
  between pending, confirmed, ticketed and so on.

### Row 4 — Four "work to do" boxes

These are the warning lights:

- **Pending ticketing** — confirmed, but the ticket is still not issued
- **Overdue follow-ups** — promises to call back that are now late
- **High priority open** — urgent bookings still unsolved
- **Refunds needing attention** — refund requests waiting for a decision

### Row 5 — Four tables

- **MCO supplier report** — which suppliers we used and for how much
- **Agent performance** — how many bookings each staff member made
- **Recent bookings** — the newest bookings, clickable
- **Overdue follow-ups** — the actual late tasks, with who they belong to

> **An honest detail worth noticing:** the Agent performance panel carries the
> note *"Counts and value only. Agents are not ranked on unvalidated metrics."*
> The website deliberately refuses to award staff a score out of 10, because a
> score made from the wrong numbers would be unfair to real people.

---

## 7. Bookings — the heart of the website

### 7a. All Bookings

**Address:** `/admin/bookings`

The master list of every booking ever made. You can filter it by customer name,
booking number, status, ticketing status, date range, agent and more.

The table columns are: Customer · Confirmation · Gross/net MCO · Booking status
· Ticketing · MCO · Agent · Booked date.

There is also an **Export CSV** button (if you are allowed) so the list can be
opened in Excel.

### 7b. Create Flight Booking

**Address:** `/admin/bookings/new/flight`

A long form, split into collapsible sections so you are not frightened by one
giant wall of boxes. You fill in:

- **Customer** — pick an existing one, or create a new one
- **Flight details** — airline, confirmation number (PNR), class
- **Flight segments** — you can add as many legs as you need. Delhi→Dubai is
  one segment; Delhi→Dubai→London is two.
- **Passengers** — name, type (adult/child/infant), date of birth, passport
- **Money** — total price, supplier cost, currency
- **Extra** — supplier, booking source, language, assigned agent

### 7c. Create Cruise Booking

**Address:** `/admin/bookings/new/cruise`

Almost the same form, but with cruise words instead of flight words: the ship's
name, the sailing date, the cabin number, the ports it visits.

> **A thoughtful difference:** a flight booking gets *ticketed* by an airline,
> but a cruise is simply *confirmed* by the cruise line — there is no ticket. So
> on a cruise booking, the website **hides the whole ticketing panel and the
> ticket-number column**. It does not show you an empty box that will never be
> filled.

### 7d. Booking Detail — the biggest page in the website

**Address:** `/admin/bookings/<id>`

This is the single most important screen. It is **811 lines of code** and it
pulls together everything about one booking in one place. Think of it as the
booking's complete file folder.

At the very top: the booking number, the customer's name as a link, and three
coloured badges — booking status, ticketing status, and priority.

Below that, the page is split into two columns.

**Left column — the facts:**

| Panel | What is inside |
|---|---|
| **Overview** | Booking type, source, language, when booked, who created it, assigned agent, supplier, MCO supplier and status, contact name/email/phone |
| **Itinerary** *(flights)* | Every flight leg: flight number, from, to, departure, arrival, class |
| **Sailing** *(cruises)* | Ship, sailing date, cabin, ports |
| **Passengers** | Name, type, date of birth, passport number |
| **Ticketing** *(flights only)* | Has the ticket been issued? What number? |
| **Accounting** | Total price, supplier cost, and the **margin** (profit) in between |
| **Payments** | Every payment: reference, amount, method, status, source, date |
| **Refunds and voids** | Every refund request and where it has reached |
| **Documents** | Tickets, passport scans, invoices attached to this booking |

**Right column — the actions:**

| Panel | What it does |
|---|---|
| **Status** | Buttons to move the booking forward in its life |
| **Follow-ups** | Create a reminder: *"call this customer by Friday"*, assigned to a person |
| **Comments** | A conversation thread between staff about this booking |
| **Status history** | A permanent diary: who changed what, when, and why |

#### The passport secret

The **Passengers** panel has a clever trick. If your role does **not** include
the `passenger.viewSensitive` ticket, passport numbers and dates of birth are
**removed from the page before it is even built**.

Why does this matter so much? Many websites hide secrets using CSS — the data is
still sitting there in the page, and anyone who presses `Ctrl+U` can read it.
Here, the data never reaches the browser in the first place. There is literally
nothing to find.

#### The status buttons — a one-way staircase

A booking cannot jump around randomly. It walks a set path:

```
   DRAFT ──> PENDING ──> CONFIRMED ──> TICKETED ──> COMPLETED
     |           |            |            |            |
     |           v            |            |            |
     |     NEEDS_REVIEW <-----+------------+------------+
     |           |
     v           v
  CANCELLED  CANCELLED
```

The rules, in plain words:

- You can only move to a status that is **actually allowed** from where you are.
  The buttons for impossible moves are not even drawn.
- **CANCELLED is the end.** You can never un-cancel a booking. If the customer
  changes their mind, you make a *new* booking — so the cancelled record keeps
  its own honest history forever.
- **COMPLETED** is also an ending, but a dispute after the trip can send it back
  to NEEDS_REVIEW.

**Proof is required before you can move forward.** This is the best rule in the
whole system:

- To mark a booking **CONFIRMED**, it must already have an airline confirmation
  reference **and** at least one passenger.
- To mark it **TICKETED**, the ticket status must be "Issued", at least one
  passenger must have a real ticket number, **and** there must be a confirmation
  reference.

If something is missing, the website does not just say "Error." It tells you
exactly what to go and fetch:

> *"This booking cannot be marked TICKETED yet. It still needs a ticket number
> on at least one passenger."*

And **cancelling or sending to review requires you to type a reason.** You
cannot silently kill a booking. Somebody's name and somebody's explanation is
attached, forever, in the Status history panel.

### 7e. High Priority

**Address:** `/admin/high-priority`

A short list showing **only** the bookings marked High or Urgent that are still
open. This is the "fires that need putting out today" screen. Columns: booking,
customer, priority, status, due date, assigned person, value, travel date.

---

## 8. Customers

### Customers list

**Address:** `/admin/customers`

Every person the agency has ever dealt with. Columns: Reference · Name · Email
· Phone · Bookings count · Status · Created date. Search by name, email or
phone.

### New Customer

**Address:** `/admin/customers/new`

A form for name, email, phone and billing address.

> **A helpful feature:** before saving, the website looks for anyone who already
> has that same email or phone number and **warns you**. This stops the same
> person ending up in the system three times as "Rahul C", "R. Choudhary" and
> "rahul choudhary" — which would scatter their bookings across three files.

### Customer Detail

**Address:** `/admin/customers/<id>`

One person's complete file:

- **Contact** panel — all their details
- **Billing address** panel
- **Their bookings** — every trip they have ever taken with us
- **Internal notes** — private staff notes the customer never sees

### Edit Customer

**Address:** `/admin/customers/<id>/edit` — the same form, pre-filled.

---

## 9. Money: Payments, Refunds, Chargebacks

This is the part that must never, ever be wrong. A mistake here means real money
genuinely lost.

### 9a. Payments

**Address:** `/admin/payments`

Every payment the agency has received. Columns: Reference · Booking · Customer ·
Amount · Method · Status · Source · Reconciliation · Recorded date.

Three important ideas:

**1. A payment has a *status*.** Writing a row in the computer is not the same
as money arriving in the bank. A payment can be pending, authorised, captured or
failed. **Only `CAPTURED` counts as real money.** Everything else is a hope.

**2. A payment has a *capture mode*.** This records *how we know*:
- A staff member **typed it in** by hand, or
- A **payment provider confirmed** it electronically.

A hand-typed record is a human's claim. A provider-confirmed one is evidence.
The website keeps them visibly apart and never pretends one is the other.

**3. Reconciliation.** A separate tick meaning *"we checked the real bank
statement and this payment is genuinely there."*

#### What is deliberately NOT stored

The original paper prototype had boxes for the full card number, the CVV and the
expiry date. **None of that exists here, and it never will.**

Why? Storing a CVV is **forbidden** by the worldwide card-security rules
(PCI DSS). And storing a full card number would drag this entire application
into an expensive, strict legal regime.

So the website keeps only: the **card brand** (Visa), the **last four digits**
(•••• 4242), and the **provider's transaction id**. That is enough to recognise a
payment and completely useless to a thief.

### 9b. Refunds & Voids

**Address:** `/admin/refunds`

Giving money back. Columns: Reference · Booking · Kind · Requested · Approved ·
Status · Reason.

A refund walks its own staircase:

```
PENDING ──> APPROVED ──> PROCESSING ──> COMPLETED  (the end)
   |            |             |
   |            |             v
   |            |          FAILED ──> (try again) PROCESSING
   v            v             |
REJECTED    REJECTED <--------+
 (the end)
```

#### Three locks so money is never refunded twice

This is the cleverest engineering in the whole project. Imagine a staff member
clicks "Refund ₹10,000", the page is slow, and they impatiently click again.
Without protection, the customer gets ₹20,000 and the agency loses ₹10,000.

Three separate locks stop this, and **all three are needed**:

1. **A unique key.** Every refund submission carries its own fingerprint. If the
   same fingerprint arrives twice, the website hands back the *original* refund
   instead of making a second one.

2. **A row lock.** When a refund is being checked, the booking is **locked**
   (`SELECT … FOR UPDATE`). A second request must wait in the queue. Without
   this, two requests could both read "₹10,000 available" at the exact same
   moment and both be approved.

3. **In-flight counting.** Refunds that are requested but not yet paid still
   count as *claiming* that money. So a second request for the same money is
   refused on its own merits, not by luck.

#### Two more human rules

- **The person who asked for a refund cannot approve it.** Two different humans
  must agree. This is the oldest anti-fraud rule in accounting, and it is built
  into the code.
- **Big refunds need the boss.** Above a configured amount, only a SUPER_ADMIN
  can approve. And that limit lives in Settings, so the boss can change it
  without calling a programmer.

### 9c. Chargebacks

**Address:** `/admin/chargebacks`

A **chargeback** is when a customer goes to their bank and says *"I never
authorised this payment, take it back."* The bank pulls the money out of the
agency's account and the agency has a short deadline to prove the booking was
genuine.

The page columns: Reference · Booking · Disputed amount · Reason · Status ·
**Deadline** · Evidence count · Assigned to · Outcome.

If any case on the page is past its deadline, a **red warning banner** appears
at the top. Missing a chargeback deadline means automatically losing the money,
so the website shouts about it.

Each case collects **evidence** — the booking confirmation, the ticket, the
email where the customer agreed.

> **An honest limit:** the website *prepares and tracks* the case. It cannot
> *submit* it to the bank, because no bank integration is connected yet. The
> README says this out loud rather than pretending.

---

## 10. Documents

**Address:** `/admin/documents`

Where tickets, passport scans, invoices and receipts live. Columns: Title ·
Category · Linked to · Origin · Verification · Version · Uploaded · Actions.
There is an upload panel on the right.

Three things make this screen more careful than a normal file upload:

**1. Files are stored outside the public folder.** In a web project, anything in
the `public/` folder is handed to *anyone* who guesses its web address — no
login needed. Passport scans must never live there. So uploads go to a private
folder on disk that the web server will not serve.

**2. Every single download is permission-checked.** Files come out through one
guarded door: `/api/admin/documents/<id>/view`. That door re-checks your
`document.view` permission **every time** — not once at upload, but on every
fetch. There is **no public link and no shareable secret URL**. A file address
copied and pasted into WhatsApp is useless to the person who receives it.

**3. Documents have an *origin* and *versions*.** Origin records whether the
file truly came from the airline or was generated by us internally — a PDF we
made ourselves is honestly labelled `INTERNALLY_GENERATED`. And when a document
is replaced, the old version is kept rather than destroyed.

---

## 11. Daily work screens

These four pages are what the Support team lives in all day.

### Latest Comments

**Address:** `/admin/comments`

Normally comments live inside their own booking. But if you want to know *"what
has the whole team been saying today, across every booking?"*, this page pulls
them all into one stream.

### Customer Service

**Address:** `/admin/customer-service`

Complaint tickets. Columns: Case · Customer · Booking · Category · Priority ·
Status · Assigned · Opened. Each case is a problem that has been opened,
assigned to someone, and must eventually be closed.

### Call Management

**Address:** `/admin/call-management`

A diary of phone calls. Columns: When · Direction (did we call them or did they
call us?) · Outcome · Duration · Customer · Booking · Agent · Notes.

So when a customer says *"but I already explained this to someone last Tuesday"*,
the staff can actually find that call.

### Follow-ups

Follow-ups do not have their own menu page. They live **inside each booking**,
and the late ones are gathered onto the **Dashboard**. A follow-up is a promise:
*"ring this customer by Friday."* When Friday passes, it turns **red** and
appears in the overdue list. Promises cannot quietly disappear.

---

## 12. Messages and Notifications

### Inbox

**Address:** `/admin/messages`

Internal messages between staff — like an email system that lives inside the
CRM, so conversations about bookings stay next to the bookings. The title shows
the unread count.

### Compose

**Address:** `/admin/messages/compose` — write a new message to a person or a group.

### Sent

**Address:** `/admin/messages/sent` — everything you have sent.

### Groups

**Address:** `/admin/messages/groups`

Make a named group, like "Flight Team", so one message reaches everyone in it.
Columns: Name · Members · Messages · Status · Created.

### Notifications

**Address:** `/admin/notifications`

A history of automatic messages the system tried to send out — emails and SMS.
Columns: Event · Channel · Recipient · Template · Status · Attempts · Provider
reference · Created.

> **Honesty again:** a message starts at `DRAFT` or `QUEUED`. It only becomes
> `SENT` when an actual send really happened. The website refuses to claim a
> customer was informed just because a row was written in a table. The
> "Attempts" column is there precisely because sending can fail.

---

## 13. Reports

Four report pages, all sharing the same date-range picker at the top. These
answer the month-end question: *how did we do?*

### Booking Report — `/admin/reports/bookings`
How many bookings, split by status, by product (flight vs cruise), by type, by
agent and by supplier — with a trend chart and a distribution chart, plus a
"share" percentage column.

### Financial Report — `/admin/reports/financial`
Three panels, and the split between them is the point:

- **Booking value** — what we were promised
- **Cash position** — what actually moved: collected, refunded, net
- **Disputes** — chargebacks: disputed amounts and outcomes

Notice how carefully the code counts: only `CAPTURED` payments count as
collected; only `COMPLETED` refunds count as refunded. Refunds that are
*approved but not yet paid* are reported **separately**, as a commitment — money
we have promised to return but have not yet returned. Those are three genuinely
different facts and the report never blurs them.

### Agent Performance — `/admin/reports/agents`
Per staff member: bookings created, bookings assigned, ticketed, cancelled,
follow-ups done, follow-ups overdue, and total booking value.

### Supplier Performance — `/admin/reports/suppliers`
Per supplier: bookings, cancellations, booking value, supplier cost, gross MCO,
net MCO. This tells the boss which airline or cruise line is actually worth
working with.

### Exporting to Excel

Most lists have an **Export CSV** button, and the export is cleverer than it
looks:

1. It carries **your current filters** — you get what you were looking at, not
   everything.
2. It **removes money columns** for roles not allowed to see money.
3. It **stops at 10,000 rows**, and writes a line *inside the file itself*
   saying it was cut short — so nobody is misled by a half-complete
   spreadsheet.
4. It **defuses a nasty security trick** called *formula injection*.

#### What is formula injection?

Excel treats any cell starting with `=`, `+`, `-` or `@` as a **formula to run**,
not text to display. So if a customer registered with the name:

```
=HYPERLINK("http://evil.com","Click here")
```

...then the moment a staff member opened the exported file, Excel would build a
live link to a malicious website. Worse formulas can do worse things.

Putting the text in quotes does **not** fix this. The real fix, which this
project uses, is to put a single apostrophe in front of the dangerous character,
which forces Excel to treat the whole cell as plain text.

---

## 14. Administration screens

### Agents

**Address:** `/admin/agents`

The staff account list. Columns: Name · Username/dialer · Email · Phone · Role ·
Status · Created. There is a "New agent" panel to create accounts, and clicking
a name opens their detail page (Account · Security · Recent sign-in activity).

#### The password story — the best example of the project's character

The original prototype the agency showed had a column in the agent table
literally showing **every agent's password in plain text**, so a manager could
read it.

This project **refuses to reproduce that**, and the README explains why in
detail. There is:

- no "view password" button anywhere,
- no code path that even reads the password field,
- only bcrypt fingerprints stored.

So what happens when someone genuinely forgets their password? The boss issues a
**one-time password**, shown on screen exactly **once**. Not emailed, not saved,
not shown again. And resetting a password **kills every active session** for
that account at the same moment — so if a thief was already logged in, they are
thrown out.

This is a case where the developer looked at a customer requirement and said
*"no, and here is why."* That is the right answer, even though it is the harder
one.

There is also **IP allowlisting** — an agent can be restricted to signing in
only from the office network. The README is careful to note this is an extra
fence, **never a replacement for a password**.

### Suppliers

**Address:** `/admin/suppliers`

Airlines, cruise lines and other partners. Columns: Name · Type · Products ·
Contact · Bookings · Status · Added.

### MCO Suppliers

**Address:** `/admin/mco-suppliers`

A separate list for suppliers used to settle MCO balances, reported apart from
ordinary booking suppliers. Columns: Name · Mail from · Contact · Bookings ·
Status · Added.

### TFN Management

**Address:** `/admin/tfn`

TFN means **Toll-Free Number** — the 1-800 numbers customers ring for free. A
travel agency may run several, one per advertising campaign, to measure which
advertisement actually works.

Columns: Label · Number · Category · (recent calls) · All-time calls · Status ·
Added. The page shows performance over the last 30 days.

### Settings

**Address:** `/admin/settings`

Five panels:

- **Business settings** — the adjustable numbers, such as the refund threshold
  above which the boss must approve
- **Booking types** — the agency's own categories, with how many bookings use each
- **Booking lifecycle** — a table showing every status and what it can move to
- **Refund lifecycle** — the same for refunds
- **Fixed vocabularies** — the lists of words reports depend on

That third and fourth panel are unusually honest. Instead of hiding the rules
inside code where only a programmer can read them, the website **shows the staff
the rulebook**. If a booking will not move, you can come here and see exactly
why.

### Audit Logs

**Address:** `/admin/audit-logs`

The permanent, unchangeable diary of the whole system. Columns: When · Action ·
Record · Summary · Actor · IP address.

Every meaningful thing anybody does — created, updated, status changed,
exported, document viewed — is written here with **who did it** and **from which
computer**.

Nobody can edit or delete these entries. If money goes missing, this is the page
that answers the question. It is also why "it wasn't me" stops being a usable
excuse.

---

## 15. The rules that keep the website honest

These five ideas run through the entire project. They are what separate this
from a student assignment.

### Rule 1 — The lock is next to the data, not next to the door

There is **one** file, `src/lib/auth/dal.ts`, where permission checks live. Every
page and every action calls into it: `requirePermission("refund.approve")`.

Most beginner projects put the check in the *routing* layer — a gate near the
front door. The problem is that a programmer adding a new page next month can
simply forget to install a gate, and the new page is wide open.

Here the check sits **next to the data itself**. You cannot read the data
without passing through it. This project even goes further: the file
`src/proxy.ts` (the gate near the front door) carries a comment saying it is
*only a convenience and is never a boundary.*

### Rule 2 — Money is counted in whole small units

Computers are famously bad at decimals. In most programming languages:

```
0.1 + 0.2 = 0.30000000000000004
```

That tiny error is harmless in a game and a disaster in accounting — across a
million transactions it becomes real missing money.

So this website **never uses decimals for money**. It stores whole numbers of
the smallest unit: 1,050 paise instead of ₹10.50. Every such field is named
ending in `Minor` so nobody can confuse it, and every one sits beside a currency
column so a number is never floating around without knowing what money it is.

### Rule 3 — Never store what you can calculate

A booking's balance is **never saved** anywhere. Every time you look at it, it is
freshly added up from the payment, refund, chargeback and adjustment rows.

Why not just store it and save effort? Because a stored total can **drift**. One
bug in one update path, and the stored total says ₹5,000 while the actual
payments say ₹4,000 — and now nobody knows which to believe. By calculating it
every time, the summary **cannot possibly disagree** with what it summarises.

Five money words are each given exactly one meaning, written down in
`src/lib/financial/booking-balance.ts`:

| Word | Exact meaning |
|---|---|
| **Gross booking value** | What the customer agreed to pay. True even if no money moved. |
| **Collected** | Captured payments only. A pending payment counts for nothing. |
| **Refunded** | Completed refunds only. An approved-but-unpaid refund has not left. |
| **Outstanding** | Gross value minus net collected, minus adjustments. |
| **Refundable** | Collected minus already refunded, never below zero. |

### Rule 4 — Say only what is true

The README has a whole section called *"Claims this application does not make."*
It is a list of things the software is careful **not** to pretend:

- A payment is not successful just because somebody saved a reference number.
- A message is not delivered just because a row was written in a table.
- A PDF the system made itself is labelled as made by itself, not as issued by
  the airline.
- Creating a supplier record does **not** open any connection to an airline.
- PNR decoding does not work, because no airline integration exists — so the
  raw PNR text is simply stored exactly as it was typed.
- A chargeback case is prepared and tracked, but not submitted to any bank.

Most software quietly implies more than it does. This one writes down its own
limits. A user who knows the limits can work around them; a user who was misled
cannot.

### Rule 5 — Mistakes must be impossible, not merely discouraged

Notice the pattern that repeats everywhere:

- Can't skip a booking status → the invalid buttons are **not drawn**
- Can't confirm without evidence → the move is **blocked and explained**
- Can't approve your own refund → **blocked in the code**
- Can't double-refund → **three independent locks**
- Can't read a passport number without permission → **data never sent to the browser**
- Can't add dollars to rupees → the function **throws an error**

The website does not say "please be careful." It makes the wrong thing
genuinely impossible. This is the difference between a warning sign and a fence.

---

## 16. How the code is arranged

Four layers, each with one clear job:

```
  src/app/admin/...        <- PAGES.    What you see on screen.
          |
  src/features/...         <- FORMS + ACTIONS. What happens when you click.
          |
  src/server/services/...  <- RULES.    The actual business logic. 15 files.
          |
  src/lib/...              <- TOOLS.    Money maths, permissions, audit, storage.
          |
  prisma/schema.prisma     <- THE DATABASE SHAPE. ~45 tables.
```

The golden rule: **a page never talks to the database directly.** It asks a
service. The service applies the rules. This means the same rule applies whether
you arrive from a web page, a form, or an API — there is no back door that skips
the rules.

### The tools it is built with

| Part | Tool | What it does |
|---|---|---|
| Framework | **Next.js 16** | Runs the whole website |
| Language | **TypeScript (strict)** | Catches mistakes *before* the code runs |
| Look | **Tailwind CSS v4** | The styling |
| Database | **PostgreSQL** | Where everything is stored |
| Database helper | **Prisma 7** | Lets the code talk to the database safely |
| Checking | **Zod 4** | Checks every form input before trusting it |
| Tables & charts | **TanStack Table, Recharts** | The grids and graphs |
| Forms | **React Hook Form** | Makes the big forms work |
| Logging | **Pino** | Keeps a running diary, hiding secrets |
| Testing | **Vitest + Playwright** | Robots that check the website still works |

### By the numbers

- **163** TypeScript files
- **~45** database tables, in a **1,318**-line schema
- **36** pages, **~7,400** lines of page code
- **15** service files holding the business rules
- **~60** permissions across **5** roles
- **24** sidebar links in **7** groups
- **228** automated tests

---

## 17. Words you will keep seeing

| Word | Easy meaning |
|---|---|
| **CRM** | The "everything book" for customers |
| **Booking** | One trip somebody bought |
| **PNR** | The airline's reference code for a booking |
| **Itinerary** | The travel plan — where you go and when |
| **Segment** | One leg of a journey. Delhi→Dubai→London is two segments. |
| **Ticketed** | The real ticket has been issued |
| **MCO** | A settlement document used between agencies and suppliers |
| **TFN** | Toll-Free Number — the free 1-800 line customers ring |
| **Supplier** | The airline or cruise line we buy from |
| **Chargeback** | The customer's bank forcibly takes a payment back |
| **Reconciliation** | Checking our records against the real bank statement |
| **Captured** | The money genuinely arrived. Anything else is a hope. |
| **Audit log** | The unchangeable diary of who did what |
| **Permission** | A small ticket saying "you may do this one thing" |
| **Session** | Proof you are logged in |
| **bcrypt hash** | A scrambled password fingerprint that cannot be unscrambled |
| **Minor unit** | Money as a whole number: 1,050 paise, not ₹10.50 |
| **Idempotency** | Doing the same thing twice has the same result as doing it once |
| **Migration** | An instruction that changes the database's shape |
| **Seed** | Filling a fresh database with its starting data |

---

## 18. What is finished and what is left

The project was built in seven planned phases.

| Phase | What it covered | Status |
|---|---|---|
| 1 | Foundation, database, login, the admin shell | ✅ Done |
| 2 | Dashboard, flight bookings, customers | ✅ Done |
| 3 | Cruise bookings, documents, protected viewing | ✅ Done |
| 4 | Payments, refunds, chargebacks | ✅ Done |
| 5 | High priority, agents, suppliers, TFN, service, settings | ✅ Done |
| 6 | Messaging, notifications, reports, CSV export | ✅ Done |
| 7 | Testing, security review, deployment, backups | 🔧 In progress |

**Every link in the sidebar now goes to a real, working page.** Nothing is a
dead end.

### What is happening right now

Phase 7 is underway. The current work-in-progress is:

- **Playwright tests** are being written (778 lines so far) — these are robots
  that open a real browser, log in, click through the pages and check everything
  behaves.
- **A redirect bug was just fixed.** The old code bounced anyone holding a login
  cookie away from the login page. But a cookie can be stale — expired, revoked
  or fake. So the user hit an endless loop: `/admin` → "not logged in, go to
  login" → `/admin/login` → "you have a cookie, go to /admin" → forever. The
  browser gave up with `ERR_TOO_MANY_REDIRECTS` and the person was locked out
  until they manually cleared their cookies. The fix removes that bounce
  entirely: only the database can decide whether a session is real, and the
  login page does that check itself.

### Current health

- ✅ **TypeScript** — clean, no errors
- ⚠️ **Tests** — 227 of 228 pass. The one failure is a database connection
  dropping under heavy parallel testing, not a bug in the business logic.

### Two things worth knowing

1. **This code exists only on this one computer.** There is no GitHub, no
   GitLab, no backup anywhere. If this hard drive fails, months of work are
   gone. Setting up a remote should probably be the very next job.

2. **Phase 7 is not committed yet.** The Playwright tests and the redirect fix
   are still sitting as uncommitted changes.

---

## The one-paragraph summary

This is a staff-only website for a travel agency. Staff log in, create customers
and bookings for flights and cruises, move those bookings along a strict path
from draft to ticketed, take payments, give refunds, fight chargebacks, store
passports and tickets safely, log phone calls, chase follow-ups, message each
other, and read reports at the end of the month. Five staff roles each see a
different slice of it. What makes it unusual is not the feature list — plenty of
systems have those — it is the **discipline**: money is never stored as a
decimal, balances are never stored at all, passwords can never be read back,
passport numbers never reach a browser that should not have them, refunds are
locked three separate ways, every action is written into a diary nobody can
edit, and the README openly lists the things the software **cannot** do rather
than quietly implying it can.

---

*Written as a plain-language walkthrough of the Travel Booking Admin CRM.*
