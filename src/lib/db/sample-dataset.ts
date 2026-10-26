import {
  AdjustmentKind,
  AdminRole,
  AdminUserStatus,
  AuditAction,
  BookingPriority,
  BookingProduct,
  BookingStatus,
  CallDirection,
  CallOutcome,
  ChargebackStatus,
  CommentVisibility,
  CustomerStatus,
  DocumentCategory,
  DocumentOrigin,
  DocumentVerificationStatus,
  FollowUpStatus,
  McoStatus,
  MessageStatus,
  NotificationChannel,
  NotificationStatus,
  PassengerType,
  PaymentCaptureMode,
  PaymentMethod,
  PaymentStatus,
  ReconciliationStatus,
  RefundKind,
  RefundStatus,
  ServiceCaseStatus,
  SupplierType,
  TicketStatus,
} from "@/generated/prisma/enums";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * A sample agency, for looking at the application with something in it.
 *
 * An empty database leaves every page showing its empty state: no bookings to
 * open, no payments to reconcile, no refund to approve, nothing to report on.
 * You can reach each screen and learn nothing from any of them.
 *
 * This writes a small but complete agency — staff, customers, bookings and the
 * financial and operational records hanging off them — so every list, detail
 * page, filter and report has something real to show.
 *
 * Two properties are deliberate:
 *
 * Every identifier is fixed and prefixed `demo`. That makes the whole dataset
 * trivially identifiable afterwards, which is what lets `db:sample:clear`
 * remove exactly these rows and nothing an operator typed in.
 *
 * Dates are relative to the moment of seeding. A follow-up that was overdue
 * when the fixtures were written would otherwise claim to be overdue by a
 * growing number of years; anchoring to `now` keeps "due in 2 days" true
 * whenever this is run.
 *
 * THIS IS NOT PRODUCTION DATA. The staff rows are real AdminUser records with
 * SUPER_ADMIN and FINANCE roles among them, created with an unusable password
 * hash so none can be signed into. Seeding this into a database that serves
 * real customers would put fictional people in the agent list and fictional
 * money in the reports. `npm run db:sample` refuses to run where real bookings
 * already exist.
 */

/** Minor units: 1234.56 USD is 123456. */
const dollars = (amount: number): number => Math.round(amount * 100);

interface Clock {
  /** `n` days from boot; negative is in the past. */
  days: (n: number) => Date;
  /** `n` hours from boot. */
  hours: (n: number) => Date;
}

function clockFrom(now: Date): Clock {
  const at = (ms: number): Date => new Date(now.getTime() + ms);
  return {
    days: (n) => at(n * 86_400_000),
    hours: (n) => at(n * 3_600_000),
  };
}

/** Counts written, for the one log line the bootstrap emits. */
export interface SampleSeedSummary {
  staff: number;
  customers: number;
  bookings: number;
  payments: number;
  refunds: number;
  chargebacks: number;
  cases: number;
  calls: number;
  messages: number;
  documents: number;
}

// --- Staff ------------------------------------------------------------------

/**
 * Colleagues for the demo administrator.
 *
 * Needed for more than the agent list: assignment dropdowns, the "assigned to"
 * columns, agent performance reporting and the message recipient picker are all
 * empty with a single account, and several of those screens read as broken
 * rather than unpopulated.
 *
 * The digest is a value no password can produce — bcrypt output always begins
 * `$2` — so none of these accounts can be signed into. They exist to be
 * referenced, not used.
 */
const UNUSABLE_PASSWORD = "demo-account-no-password";

const STAFF = [
  {
    id: "demostaff000000000000000a1",
    email: "nadia.rahman@travel-crm.invalid",
    username: "ops.nadia",
    name: "Nadia Rahman",
    role: AdminRole.OPERATIONS,
    team: "Air desk",
    dialerId: "4101",
  },
  {
    id: "demostaff000000000000000a2",
    email: "marcus.webb@travel-crm.invalid",
    username: "ops.marcus",
    name: "Marcus Webb",
    role: AdminRole.OPERATIONS,
    team: "Air desk",
    dialerId: "4102",
  },
  {
    id: "demostaff000000000000000a3",
    email: "elena.fischer@travel-crm.invalid",
    username: "fin.elena",
    name: "Elena Fischer",
    role: AdminRole.FINANCE,
    team: "Finance",
    dialerId: "4201",
  },
  {
    id: "demostaff000000000000000a4",
    email: "tomas.alvarez@travel-crm.invalid",
    username: "sup.tomas",
    name: "Tomas Alvarez",
    role: AdminRole.SUPPORT,
    team: "Customer care",
    dialerId: "4301",
  },
  {
    id: "demostaff000000000000000a5",
    email: "grace.okafor@travel-crm.invalid",
    username: "sup.grace",
    name: "Grace Okafor",
    role: AdminRole.SUPPORT,
    team: "Cruise desk",
    dialerId: "4302",
  },
  {
    id: "demostaff000000000000000a6",
    email: "ivan.petrov@travel-crm.invalid",
    username: "read.ivan",
    name: "Ivan Petrov",
    role: AdminRole.READ_ONLY,
    team: "Quality",
    dialerId: null,
  },
] as const;

const [NADIA, MARCUS, ELENA, TOMAS, GRACE] = STAFF.map((s) => s.id) as [
  string,
  string,
  string,
  string,
  string,
];

// --- Reference data ---------------------------------------------------------

const SUPPLIERS = [
  {
    id: "demosupplier00000000000s1",
    name: "Atlantic Air Consolidator",
    type: SupplierType.CONSOLIDATOR,
    contactName: "Dana Whitfield",
    contactEmail: "bookings@atlantic-consolidator.invalid",
    contactPhone: "+1 212 555 0141",
    supportedProducts: [BookingProduct.FLIGHT],
  },
  {
    id: "demosupplier00000000000s2",
    name: "Meridian Airways",
    type: SupplierType.AIRLINE,
    contactName: "Group Desk",
    contactEmail: "groups@meridian-air.invalid",
    contactPhone: "+1 800 555 0177",
    supportedProducts: [BookingProduct.FLIGHT],
  },
  {
    id: "demosupplier00000000000s3",
    name: "Northern Star Cruise Line",
    type: SupplierType.CRUISE_LINE,
    contactName: "Trade Support",
    contactEmail: "trade@northernstar-cruises.invalid",
    contactPhone: "+1 305 555 0112",
    supportedProducts: [BookingProduct.CRUISE],
  },
  {
    id: "demosupplier00000000000s4",
    name: "Voyager OTA Partner",
    type: SupplierType.OTA,
    contactName: "Partner Desk",
    contactEmail: "partners@voyager-ota.invalid",
    contactPhone: "+44 20 7946 0102",
    supportedProducts: [BookingProduct.FLIGHT, BookingProduct.CRUISE],
  },
  {
    id: "demosupplier00000000000s5",
    name: "Airline website",
    type: SupplierType.AIRLINE,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    supportedProducts: [BookingProduct.FLIGHT],
  },
] as const;

const MCO_SUPPLIERS = [
  {
    id: "democomco0000000000000m1",
    name: "Skyhyflights",
    mailFrom: "mco@skyhyflights.invalid",
    contactEmail: "settlements@skyhyflights.invalid",
    contactPhone: "+1 702 555 0188",
  },
  {
    id: "democomco0000000000000m2",
    name: "Skyhyplanners",
    mailFrom: "mco@skyhyplanners.invalid",
    contactEmail: "settlements@skyhyplanners.invalid",
    contactPhone: "+1 702 555 0189",
  },
  {
    id: "democomco0000000000000m3",
    name: "Horizon Settlements",
    mailFrom: "mco@horizon-settle.invalid",
    contactEmail: "ops@horizon-settle.invalid",
    contactPhone: "+1 702 555 0190",
  },
] as const;

const TFNS = [
  {
    id: "demotfn00000000000000t1",
    number: "+1 888 555 0101",
    label: "Flights — main line",
    category: "Flights",
  },
  {
    id: "demotfn00000000000000t2",
    number: "+1 888 555 0102",
    label: "Cruises — main line",
    category: "Cruises",
  },
  {
    id: "demotfn00000000000000t3",
    number: "+1 888 555 0103",
    label: "Changes and cancellations",
    category: "Service",
  },
  {
    id: "demotfn00000000000000t4",
    number: "+1 888 555 0104",
    label: "Partner overflow",
    category: "Partners",
  },
] as const;

/**
 * Settings the application reads at runtime.
 *
 * Kept identical to `prisma/seed.ts`, which writes the same keys to a hosted
 * database — a demo whose refund threshold differed from production's would
 * demonstrate behaviour the real system does not have.
 */
const BUSINESS_SETTINGS = [
  {
    key: "supported_currencies",
    value: ["USD", "CAD", "GBP", "EUR", "AUD"],
    description: "Currencies that may be selected on a booking.",
  },
  {
    key: "default_currency",
    value: "USD",
    description: "Currency pre-selected on new bookings.",
  },
  {
    key: "business_timezone",
    value: "UTC",
    description: "Timezone used to bucket dates in reports.",
  },
  {
    key: "refund_approval_threshold_minor",
    value: 50_000,
    description:
      "Refunds at or above this amount in minor units require SUPER_ADMIN approval.",
  },
  {
    key: "document_max_bytes",
    value: 15 * 1024 * 1024,
    description: "Largest accepted document upload.",
  },
  {
    key: "document_allowed_content_types",
    value: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    description: "Content types accepted for document upload.",
  },
] as const;

// --- Customers --------------------------------------------------------------

const CUSTOMERS = [
  {
    first: "Alice",
    last: "Thornton",
    city: "Boston",
    state: "MA",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Daniel",
    last: "Okonkwo",
    city: "Houston",
    state: "TX",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Mei",
    last: "Lin",
    city: "San Jose",
    state: "CA",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Robert",
    last: "Castellano",
    city: "Newark",
    state: "NJ",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Fatima",
    last: "Haddad",
    city: "Dearborn",
    state: "MI",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "James",
    last: "Whitfield",
    city: "Manchester",
    state: null,
    country: "GB",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Sofia",
    last: "Marchetti",
    city: "Toronto",
    state: "ON",
    country: "CA",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Henry",
    last: "Osei",
    city: "Atlanta",
    state: "GA",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Clara",
    last: "Nowak",
    city: "Chicago",
    state: "IL",
    country: "US",
    status: CustomerStatus.INACTIVE,
  },
  {
    first: "Victor",
    last: "Mendoza",
    city: "Phoenix",
    state: "AZ",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Priya",
    last: "Raghavan",
    city: "Seattle",
    state: "WA",
    country: "US",
    status: CustomerStatus.ACTIVE,
  },
  {
    first: "Tomas",
    last: "Berg",
    city: "Minneapolis",
    state: "MN",
    country: "US",
    status: CustomerStatus.BLOCKED,
  },
] as const;

const customerId = (index: number): string =>
  `democust${String(index).padStart(4, "0")}000000000000`;

// --- Bookings ---------------------------------------------------------------

/**
 * The booking spine.
 *
 * Statuses, priorities and products are spread deliberately rather than
 * randomly: the high-priority queue, the ticketing desk, the refund workflow
 * and the cancellation reports each need rows that qualify for them, and a
 * uniform dataset leaves half the application looking broken.
 */
interface BookingSpec {
  index: number;
  customer: number;
  product: BookingProduct;
  status: BookingStatus;
  priority: BookingPriority;
  ticket: TicketStatus;
  agent: string;
  supplier: number;
  total: number;
  cost: number;
  /** Days from boot; negative means already booked. */
  bookedDaysAgo: number;
  /** Days from boot until travel. */
  travelInDays: number;
  /** Days from boot for the follow-up, or null for none. */
  followUpInDays: number | null;
  source: string;
}

const BOOKINGS: BookingSpec[] = [
  { index: 1, customer: 0, product: BookingProduct.FLIGHT, status: BookingStatus.TICKETED, priority: BookingPriority.NORMAL, ticket: TicketStatus.ISSUED, agent: NADIA, supplier: 0, total: 2480.0, cost: 2105.0, bookedDaysAgo: -41, travelInDays: 12, followUpInDays: null, source: "Phone" },
  { index: 2, customer: 1, product: BookingProduct.FLIGHT, status: BookingStatus.CONFIRMED, priority: BookingPriority.URGENT, ticket: TicketStatus.IN_PROGRESS, agent: NADIA, supplier: 1, total: 5310.5, cost: 4620.0, bookedDaysAgo: -6, travelInDays: 4, followUpInDays: -1, source: "Phone" },
  { index: 3, customer: 2, product: BookingProduct.CRUISE, status: BookingStatus.CONFIRMED, priority: BookingPriority.HIGH, ticket: TicketStatus.NOT_APPLICABLE, agent: GRACE, supplier: 2, total: 7840.0, cost: 6900.0, bookedDaysAgo: -18, travelInDays: 36, followUpInDays: 2, source: "Web" },
  { index: 4, customer: 3, product: BookingProduct.FLIGHT, status: BookingStatus.NEEDS_REVIEW, priority: BookingPriority.URGENT, ticket: TicketStatus.FAILED, agent: MARCUS, supplier: 0, total: 1960.0, cost: 1780.0, bookedDaysAgo: -3, travelInDays: 9, followUpInDays: -2, source: "Partner" },
  { index: 5, customer: 4, product: BookingProduct.FLIGHT, status: BookingStatus.COMPLETED, priority: BookingPriority.LOW, ticket: TicketStatus.ISSUED, agent: MARCUS, supplier: 1, total: 1320.0, cost: 1145.0, bookedDaysAgo: -94, travelInDays: -37, followUpInDays: null, source: "Web" },
  { index: 6, customer: 5, product: BookingProduct.FLIGHT, status: BookingStatus.CANCELLED, priority: BookingPriority.NORMAL, ticket: TicketStatus.VOIDED, agent: NADIA, supplier: 3, total: 2215.0, cost: 1990.0, bookedDaysAgo: -52, travelInDays: -8, followUpInDays: null, source: "Phone" },
  { index: 7, customer: 6, product: BookingProduct.CRUISE, status: BookingStatus.TICKETED, priority: BookingPriority.NORMAL, ticket: TicketStatus.NOT_APPLICABLE, agent: GRACE, supplier: 2, total: 4495.0, cost: 3980.0, bookedDaysAgo: -27, travelInDays: 58, followUpInDays: 14, source: "Web" },
  { index: 8, customer: 7, product: BookingProduct.FLIGHT, status: BookingStatus.PENDING, priority: BookingPriority.HIGH, ticket: TicketStatus.PENDING, agent: MARCUS, supplier: 0, total: 3075.0, cost: 2740.0, bookedDaysAgo: -2, travelInDays: 21, followUpInDays: 1, source: "Phone" },
  { index: 9, customer: 8, product: BookingProduct.FLIGHT, status: BookingStatus.COMPLETED, priority: BookingPriority.LOW, ticket: TicketStatus.ISSUED, agent: NADIA, supplier: 4, total: 880.0, cost: 770.0, bookedDaysAgo: -120, travelInDays: -71, followUpInDays: null, source: "Web" },
  { index: 10, customer: 9, product: BookingProduct.FLIGHT, status: BookingStatus.CONFIRMED, priority: BookingPriority.HIGH, ticket: TicketStatus.PENDING, agent: MARCUS, supplier: 1, total: 6120.0, cost: 5480.0, bookedDaysAgo: -9, travelInDays: 17, followUpInDays: -4, source: "Partner" },
  { index: 11, customer: 10, product: BookingProduct.CRUISE, status: BookingStatus.CONFIRMED, priority: BookingPriority.NORMAL, ticket: TicketStatus.NOT_APPLICABLE, agent: GRACE, supplier: 2, total: 9980.0, cost: 8720.0, bookedDaysAgo: -33, travelInDays: 74, followUpInDays: 21, source: "Phone" },
  { index: 12, customer: 0, product: BookingProduct.FLIGHT, status: BookingStatus.TICKETED, priority: BookingPriority.NORMAL, ticket: TicketStatus.EXCHANGED, agent: NADIA, supplier: 0, total: 2740.0, cost: 2495.0, bookedDaysAgo: -62, travelInDays: 5, followUpInDays: 3, source: "Phone" },
  { index: 13, customer: 11, product: BookingProduct.FLIGHT, status: BookingStatus.DRAFT, priority: BookingPriority.LOW, ticket: TicketStatus.PENDING, agent: MARCUS, supplier: 4, total: 640.0, cost: 575.0, bookedDaysAgo: -1, travelInDays: 44, followUpInDays: null, source: "Web" },
  { index: 14, customer: 2, product: BookingProduct.FLIGHT, status: BookingStatus.CONFIRMED, priority: BookingPriority.URGENT, ticket: TicketStatus.IN_PROGRESS, agent: NADIA, supplier: 1, total: 4380.0, cost: 3990.0, bookedDaysAgo: -4, travelInDays: 2, followUpInDays: 0, source: "Phone" },
  { index: 15, customer: 3, product: BookingProduct.CRUISE, status: BookingStatus.COMPLETED, priority: BookingPriority.NORMAL, ticket: TicketStatus.NOT_APPLICABLE, agent: GRACE, supplier: 2, total: 5260.0, cost: 4610.0, bookedDaysAgo: -148, travelInDays: -52, followUpInDays: null, source: "Web" },
  { index: 16, customer: 5, product: BookingProduct.FLIGHT, status: BookingStatus.TICKETED, priority: BookingPriority.HIGH, ticket: TicketStatus.ISSUED, agent: MARCUS, supplier: 3, total: 3890.0, cost: 3410.0, bookedDaysAgo: -15, travelInDays: 28, followUpInDays: 6, source: "Partner" },
  { index: 17, customer: 7, product: BookingProduct.FLIGHT, status: BookingStatus.CANCELLED, priority: BookingPriority.NORMAL, ticket: TicketStatus.VOIDED, agent: NADIA, supplier: 0, total: 1475.0, cost: 1320.0, bookedDaysAgo: -23, travelInDays: 11, followUpInDays: null, source: "Phone" },
  { index: 18, customer: 10, product: BookingProduct.FLIGHT, status: BookingStatus.NEEDS_REVIEW, priority: BookingPriority.HIGH, ticket: TicketStatus.PENDING, agent: MARCUS, supplier: 1, total: 2950.0, cost: 2680.0, bookedDaysAgo: -5, travelInDays: 19, followUpInDays: -6, source: "Web" },
];

const bookingId = (index: number): string =>
  `demobkng${String(index).padStart(4, "0")}000000000000`;

/** Airports paired per booking so itineraries differ between records. */
const ROUTES = [
  ["BOS", "LHR", "Meridian Airways", "MA", "Economy"],
  ["IAH", "DXB", "Gulf Partner Air", "GP", "Business"],
  ["SJC", "NRT", "Pacific Wing", "PW", "Premium Economy"],
  ["EWR", "FCO", "Meridian Airways", "MA", "Economy"],
  ["DTW", "CDG", "Atlantic Link", "AL", "Economy"],
  ["MAN", "JFK", "Meridian Airways", "MA", "Business"],
  ["YYZ", "LIS", "Atlantic Link", "AL", "Economy"],
  ["ATL", "GRU", "Southern Cross", "SC", "Economy"],
  ["ORD", "MEX", "Pacific Wing", "PW", "Economy"],
  ["PHX", "HNL", "Island Hopper", "IH", "Economy"],
  ["SEA", "ICN", "Pacific Wing", "PW", "Business"],
  ["MSP", "AMS", "Atlantic Link", "AL", "Economy"],
] as const;

const CRUISE_ITINERARIES = [
  {
    line: "Northern Star Cruise Line",
    ship: "Aurora Spirit",
    itinerary: "Eastern Caribbean — San Juan, St Thomas, Tortola",
    from: "Miami, FL",
    to: "Miami, FL",
    nights: 7,
  },
  {
    line: "Northern Star Cruise Line",
    ship: "Polar Crown",
    itinerary: "Alaska Inside Passage — Juneau, Skagway, Glacier Bay",
    from: "Seattle, WA",
    to: "Seattle, WA",
    nights: 7,
  },
  {
    line: "Northern Star Cruise Line",
    ship: "Mediterra",
    itinerary: "Western Mediterranean — Barcelona, Marseille, Genoa",
    from: "Barcelona",
    to: "Barcelona",
    nights: 10,
  },
  {
    line: "Northern Star Cruise Line",
    ship: "Aurora Spirit",
    itinerary: "Bahamas short break — Nassau, Great Stirrup Cay",
    from: "Port Canaveral, FL",
    to: "Port Canaveral, FL",
    nights: 4,
  },
] as const;

const PASSENGER_NAMES = [
  ["Mr", "Oliver", "Grant"],
  ["Ms", "Hannah", "Reyes"],
  ["Mr", "Samuel", "Okoro"],
  ["Mrs", "Beatrice", "Lindqvist"],
  ["Mr", "Noah", "Fitzgerald"],
  ["Ms", "Ines", "Duarte"],
  ["Mr", "Arjun", "Natarajan"],
  ["Ms", "Leila", "Benali"],
] as const;

// --- Seeding ----------------------------------------------------------------

/**
 * Writes the dataset.
 *
 * `client` is a Prisma client bound directly to the embedded database, not the
 * application's shared one: this runs during the bootstrap, before the gate
 * that holds application queries back has opened, and going through that gate
 * from inside it would wait forever.
 *
 * Every write is `createMany` where the shape allows it. Round trips dominate
 * the cost here, and this runs on the critical path of a cold start — the
 * difference between batching and not is seconds on every new instance.
 */
export async function seedSampleDataset(
  client: PrismaClient,
  now: Date,
  /** Administrator the sample mail and message groups are addressed to. */
  ownerId: string,
): Promise<SampleSeedSummary> {
  const clock = clockFrom(now);

  await seedStaff(client, clock);
  const ids = await seedOperationalReference(client);
  await seedCustomers(client, clock);
  await seedBookings(client, clock, ids);

  const payments = await seedMoney(client, clock);
  const documents = await seedDocuments(client, clock);
  const operations = await seedOperations(client, clock);
  const messaging = await seedMessaging(client, clock, ownerId);

  await seedAuditTrail(client, clock);
  await alignReferenceSequences(client);

  return {
    staff: STAFF.length,
    customers: CUSTOMERS.length,
    bookings: BOOKINGS.length,
    documents,
    ...payments,
    ...operations,
    ...messaging,
  };
}

async function seedStaff(client: PrismaClient, clock: Clock): Promise<void> {
  await client.adminUser.createMany({
    data: STAFF.map((person, i) => ({
      id: person.id,
      email: person.email,
      username: person.username,
      name: person.name,
      phone: `+1 646 555 0${200 + i}`,
      passwordHash: UNUSABLE_PASSWORD,
      role: person.role,
      status: AdminUserStatus.ACTIVE,
      lastLoginAt: clock.hours(-(2 + i * 3)),
      updatedAt: now_(clock),
    })),
    skipDuplicates: true,
  });

  // The floor profile is separate from the login account, so an agent needs
  // both rows before appearing in call management or agent performance.
  await client.agent.createMany({
    data: STAFF.filter((person) => person.dialerId !== null).map((person) => ({
      id: `${person.id}-agent`.slice(0, 30),
      adminUserId: person.id,
      dialerId: person.dialerId,
      team: person.team,
      isActive: true,
      // A JSON column has no literal DEFAULT in MySQL, so the empty allowlist
      // is written rather than assumed.
      allowedIpRanges: [],
      updatedAt: now_(clock),
    })),
    skipDuplicates: true,
  });
}

/**
 * Maps a fixture's intended id to the one actually in the database.
 *
 * Suppliers and MCO suppliers are unique by NAME, and the real seed already
 * creates some of the same names with generated ids. Inserting the fixture
 * version is then skipped as a duplicate, the fixed `demo…` id never exists,
 * and every booking pointing at it is dropped — silently, because Prisma
 * compiles `skipDuplicates` to MySQL's `INSERT IGNORE`, which downgrades a
 * foreign-key violation to a warning rather than an error.
 *
 * That is exactly how this failed the first time: five of eighteen bookings
 * vanished with no diagnostic, and the seed only tripped later, on an
 * unrelated update. So these two tables are upserted by name and the resulting
 * id recorded here, and anything referencing them resolves through this map.
 */
export type IdMap = ReadonlyMap<string, string>;

async function seedOperationalReference(
  client: PrismaClient,
): Promise<IdMap> {
  const resolved = new Map<string, string>();

  for (const s of SUPPLIERS) {
    const row = await client.supplier.upsert({
      where: { name: s.name },
      create: {
        id: s.id,
        name: s.name,
        type: s.type,
        contactName: s.contactName,
        contactEmail: s.contactEmail,
        contactPhone: s.contactPhone,
        supportedProducts: [...s.supportedProducts],
        isActive: true,
      },
      update: {},
      select: { id: true },
    });
    resolved.set(s.id, row.id);
  }

  for (const s of MCO_SUPPLIERS) {
    const row = await client.mcoSupplier.upsert({
      where: { name: s.name },
      create: {
        id: s.id,
        name: s.name,
        mailFrom: s.mailFrom,
        contactEmail: s.contactEmail,
        contactPhone: s.contactPhone,
        isActive: true,
      },
      update: {},
      select: { id: true },
    });
    resolved.set(s.id, row.id);
  }

  await client.tfn.createMany({
    data: TFNS.map((t) => ({
      id: t.id,
      number: t.number,
      label: t.label,
      category: t.category,
      isActive: true,
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  });

  await client.businessSetting.createMany({
    data: BUSINESS_SETTINGS.map((setting, i) => ({
      id: `demosetting${String(i).padStart(3, "0")}0000000000`,
      key: setting.key,
      value: setting.value as never,
      description: setting.description,
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  });

  await client.integrationConfiguration.createMany({
    data: [
      {
        id: "demointegration000000001",
        key: "payment_provider",
        label: "Payment provider",
        isEnabled: false,
        settings: { mode: "manual", note: "No provider connected in the demo." },
        notes:
          "Payments in this deployment are recorded manually; nothing is charged.",
        updatedAt: new Date(),
      },
      {
        id: "demointegration000000002",
        key: "outbound_email",
        label: "Outbound email",
        isEnabled: false,
        settings: { driver: "none" },
        notes: "Messages are stored but never delivered.",
        updatedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  return resolved;
}

async function seedCustomers(client: PrismaClient, clock: Clock): Promise<void> {
  await client.customer.createMany({
    data: CUSTOMERS.map((c, i) => ({
      id: customerId(i),
      reference: `CUS-${100_001 + i}`,
      firstName: c.first,
      lastName: c.last,
      email: `${c.first}.${c.last}@example.invalid`.toLowerCase(),
      phone: `+1 415 555 0${String(100 + i).padStart(3, "0")}`,
      status: c.status,
      billingAddressLine1: `${100 + i * 7} Harbour Street`,
      billingCity: c.city,
      billingState: c.state,
      billingPostalCode: String(10_000 + i * 311),
      billingCountry: c.country,
      preferredLanguage: "en",
      createdAt: clock.days(-180 + i * 6),
      updatedAt: clock.days(-4),
    })),
    skipDuplicates: true,
  });

  await client.customerNote.createMany({
    data: [
      {
        id: "demonote0000000000000001",
        customerId: customerId(0),
        body: "Prefers aisle seating and evening departures. Travels for work most months.",
        authorId: NADIA,
        createdAt: clock.days(-30),
      },
      {
        id: "demonote0000000000000002",
        customerId: customerId(4),
        body: "Requires wheelchair assistance at both ends; note on every future itinerary.",
        authorId: TOMAS,
        createdAt: clock.days(-61),
      },
      {
        id: "demonote0000000000000003",
        customerId: customerId(11),
        body: "Account blocked after repeated chargebacks. Do not take new bookings without finance approval.",
        authorId: ELENA,
        createdAt: clock.days(-12),
      },
    ],
    skipDuplicates: true,
  });
}

async function seedBookings(
  client: PrismaClient,
  clock: Clock,
  /** Resolves a fixture id to the row that actually exists. See IdMap. */
  ids: IdMap,
): Promise<void> {
  const resolve = (id: string): string => ids.get(id) ?? id;

  const bookingTypes = await client.bookingType.findMany({
    select: { id: true, code: true },
  });
  const typeFor = (product: BookingProduct): string | null =>
    bookingTypes.find((t) =>
      product === BookingProduct.CRUISE ? t.code === "CRUISE" : t.code === "ROUND_TRIP",
    )?.id ?? null;

  await client.booking.createMany({
    data: BOOKINGS.map((spec) => {
      const customer = CUSTOMERS[spec.customer]!;
      const supplier = SUPPLIERS[spec.supplier]!;
      const total = dollars(spec.total);
      const taxes = Math.round(total * 0.18);

      return {
        id: bookingId(spec.index),
        bookingNumber: `MV${70_000 + spec.index}`,
        product: spec.product,
        status: spec.status,
        priority: spec.priority,
        bookingTypeId: typeFor(spec.product),
        customerId: customerId(spec.customer),
        createdById: spec.agent,
        assignedAgentId: spec.agent,
        supplierId: resolve(supplier.id),
        mcoSupplierId:
          spec.index % 4 === 0
            ? resolve(MCO_SUPPLIERS[spec.index % 3]!.id)
            : null,
        tfnId: TFNS[spec.index % TFNS.length]!.id,
        source: spec.source,
        language: "en",
        contactName: `${customer.first} ${customer.last}`,
        contactEmail:
          `${customer.first}.${customer.last}@example.invalid`.toLowerCase(),
        contactPhone: `+1 415 555 0${String(100 + spec.customer).padStart(3, "0")}`,
        billingCity: customer.city,
        billingState: customer.state,
        billingCountry: customer.country,
        ticketStatus: spec.ticket,
        airlineConfirmation:
          spec.product === BookingProduct.FLIGHT
            ? `PNR${String(spec.index).padStart(3, "0")}X`
            : null,
        ticketingReference:
          spec.ticket === TicketStatus.ISSUED
            ? `0${16 + spec.index}-${4_000_000 + spec.index * 137}`
            : null,
        ticketedAt:
          spec.ticket === TicketStatus.ISSUED
            ? clock.days(spec.bookedDaysAgo + 1)
            : null,
        mcoStatus:
          spec.index % 4 === 0 ? McoStatus.CONFIRMED : McoStatus.NOT_APPLICABLE,
        currency: "USD",
        baseFareMinor: total - taxes,
        taxesFeesMinor: taxes,
        totalMinor: total,
        supplierCostMinor: dollars(spec.cost),
        grossMcoMinor: spec.index % 4 === 0 ? dollars(spec.cost) : 0,
        netMcoMinor: spec.index % 4 === 0 ? dollars(spec.cost * 0.97) : 0,
        splitCharges: spec.index % 7 === 0,
        travelStartDate: clock.days(spec.travelInDays),
        travelEndDate: clock.days(spec.travelInDays + 9),
        followUpAt:
          spec.followUpInDays === null ? null : clock.days(spec.followUpInDays),
        bookedAt: clock.days(spec.bookedDaysAgo),
        createdAt: clock.days(spec.bookedDaysAgo),
        updatedAt: clock.days(Math.min(spec.bookedDaysAgo + 2, 0)),
      };
    }),
    skipDuplicates: true,
  });

  const flights = BOOKINGS.filter((b) => b.product === BookingProduct.FLIGHT);
  const cruises = BOOKINGS.filter((b) => b.product === BookingProduct.CRUISE);

  await client.flightDetail.createMany({
    data: flights.map((spec) => {
      const route = ROUTES[spec.index % ROUTES.length]!;
      return {
        id: `demoflight${String(spec.index).padStart(3, "0")}0000000000`,
        bookingId: bookingId(spec.index),
        pnrText: `1.${PASSENGER_NAMES[spec.index % 8]![2].toUpperCase()}/${PASSENGER_NAMES[spec.index % 8]![1].toUpperCase()}\n2 ${route[3]}  ${100 + spec.index} ${route[0]}${route[1]} HK1`,
        pnrLocator: `PNR${String(spec.index).padStart(3, "0")}X`,
        airline: route[2],
        bookingClass: route[4],
        origin: route[0],
        destination: route[1],
        departureDate: clock.days(spec.travelInDays),
        returnDate: clock.days(spec.travelInDays + 9),
        isRoundTrip: true,
        createdAt: clock.days(spec.bookedDaysAgo),
        updatedAt: clock.days(spec.bookedDaysAgo),
      };
    }),
    skipDuplicates: true,
  });

  // Outbound and return legs, so an itinerary reads as a trip rather than a
  // single hop.
  await client.flightSegment.createMany({
    data: flights.flatMap((spec) => {
      const route = ROUTES[spec.index % ROUTES.length]!;
      const out = clock.days(spec.travelInDays);
      const back = clock.days(spec.travelInDays + 9);

      return [
        {
          id: `demoseg${String(spec.index).padStart(3, "0")}a00000000000`,
          bookingId: bookingId(spec.index),
          sequence: 1,
          airline: route[2],
          flightNumber: `${route[3]}${100 + spec.index}`,
          origin: route[0],
          destination: route[1],
          departureAt: out,
          arrivalAt: new Date(out.getTime() + 8 * 3_600_000),
          bookingClass: route[4]!.slice(0, 1),
          cabin: route[4],
          operatingCarrier: route[2],
          createdAt: clock.days(spec.bookedDaysAgo),
          updatedAt: clock.days(spec.bookedDaysAgo),
        },
        {
          id: `demoseg${String(spec.index).padStart(3, "0")}b00000000000`,
          bookingId: bookingId(spec.index),
          sequence: 2,
          airline: route[2],
          flightNumber: `${route[3]}${101 + spec.index}`,
          origin: route[1],
          destination: route[0],
          departureAt: back,
          arrivalAt: new Date(back.getTime() + 9 * 3_600_000),
          bookingClass: route[4]!.slice(0, 1),
          cabin: route[4],
          operatingCarrier: route[2],
          createdAt: clock.days(spec.bookedDaysAgo),
          updatedAt: clock.days(spec.bookedDaysAgo),
        },
      ];
    }),
    skipDuplicates: true,
  });

  await client.cruiseDetail.createMany({
    data: cruises.map((spec, i) => {
      const trip = CRUISE_ITINERARIES[i % CRUISE_ITINERARIES.length]!;
      return {
        id: `democruise${String(spec.index).padStart(3, "0")}0000000000`,
        bookingId: bookingId(spec.index),
        cruiseLine: trip.line,
        ship: trip.ship,
        reservationNumber: `NS-${500_000 + spec.index}`,
        itinerary: trip.itinerary,
        departurePort: trip.from,
        arrivalPort: trip.to,
        sailDate: clock.days(spec.travelInDays),
        returnDate: clock.days(spec.travelInDays + trip.nights),
        nights: trip.nights,
        cabinNumber: `${8 + i}${String(100 + spec.index).slice(-2)}`,
        cabinCategory: i % 2 === 0 ? "Balcony" : "Ocean view",
        diningPreference: i % 2 === 0 ? "Early seating" : "Open dining",
        cabinCount: 1 + (i % 2),
        gratuitiesIncluded: i % 2 === 0,
        insuranceIncluded: i % 3 === 0,
        createdAt: clock.days(spec.bookedDaysAgo),
        updatedAt: clock.days(spec.bookedDaysAgo),
      };
    }),
    skipDuplicates: true,
  });

  // One or two travellers per booking. Passport fields are populated because
  // the sensitive-field masking is itself a feature worth demonstrating — and
  // every value here is invented.
  await client.passenger.createMany({
    data: BOOKINGS.flatMap((spec) => {
      const count = spec.index % 3 === 0 ? 2 : 1;
      return Array.from({ length: count }, (_, seat) => {
        const person = PASSENGER_NAMES[(spec.index + seat) % PASSENGER_NAMES.length]!;
        return {
          id: `demopax${String(spec.index).padStart(3, "0")}${seat}0000000000`,
          bookingId: bookingId(spec.index),
          sequence: seat + 1,
          title: person[0],
          firstName: person[1],
          lastName: person[2],
          type: seat === 1 ? PassengerType.CHILD : PassengerType.ADULT,
          gender: seat % 2 === 0 ? "M" : "F",
          dateOfBirth: clock.days(seat === 1 ? -3_650 : -12_800),
          passportNumber: `X${String(10_000_000 + spec.index * 97 + seat)}`,
          passportCountry: "US",
          passportExpiry: clock.days(900 + spec.index * 5),
          frequentFlyerNumber: seat === 0 ? `FF${700_000 + spec.index}` : null,
          ticketNumber:
            spec.ticket === TicketStatus.ISSUED
              ? `0${16 + spec.index}${4_000_000 + spec.index * 137 + seat}`
              : null,
          createdAt: clock.days(spec.bookedDaysAgo),
          updatedAt: clock.days(spec.bookedDaysAgo),
        };
      });
    }),
    skipDuplicates: true,
  });

  // The transition trail every booking detail page renders.
  await client.bookingStatusHistory.createMany({
    data: BOOKINGS.flatMap((spec) => {
      const steps: { from: BookingStatus | null; to: BookingStatus }[] = [
        { from: null, to: BookingStatus.DRAFT },
      ];
      if (spec.status !== BookingStatus.DRAFT) {
        steps.push({ from: BookingStatus.DRAFT, to: BookingStatus.PENDING });
      }
      if (spec.status !== BookingStatus.DRAFT && spec.status !== BookingStatus.PENDING) {
        steps.push({ from: BookingStatus.PENDING, to: spec.status });
      }

      return steps.map((step, i) => ({
        id: `demohist${String(spec.index).padStart(3, "0")}${i}0000000000`,
        bookingId: bookingId(spec.index),
        fromStatus: step.from,
        toStatus: step.to,
        reason:
          step.to === BookingStatus.CANCELLED
            ? "Customer cancelled before ticketing."
            : null,
        changedById: spec.agent,
        createdAt: clock.days(spec.bookedDaysAgo + i),
      }));
    }),
    skipDuplicates: true,
  });

  await client.bookingComment.createMany({
    data: BOOKINGS.flatMap((spec, i) => {
      const bodies = [
        "Customer called to confirm baggage allowance. Advised two checked bags included.",
        "Supplier holding the fare until end of day — ticket before then or it reprices.",
        "Left voicemail about the schedule change; awaiting a callback.",
        "Finance flagged a mismatch between the quoted and charged amount. Checking.",
        "Customer happy with the alternative routing offered. Proceeding.",
      ];
      const entries: Prisma.BookingCommentCreateManyInput[] = [
        {
          id: `democmt${String(spec.index).padStart(3, "0")}a00000000000`,
          bookingId: bookingId(spec.index),
          body: bodies[i % bodies.length]!,
          category: "General",
          visibility: CommentVisibility.INTERNAL,
          authorId: spec.agent,
          followUpAt:
            spec.followUpInDays === null ? null : clock.days(spec.followUpInDays),
          createdAt: clock.days(spec.bookedDaysAgo + 1),
          updatedAt: clock.days(spec.bookedDaysAgo + 1),
        },
      ];

      if (i % 3 === 0) {
        entries.push({
          id: `democmt${String(spec.index).padStart(3, "0")}b00000000000`,
          bookingId: bookingId(spec.index),
          body: "Confirmation re-sent to the customer at their request.",
          category: "Customer contact",
          visibility: CommentVisibility.CUSTOMER_FACING,
          authorId: TOMAS,
          followUpAt: null,
          createdAt: clock.days(Math.min(spec.bookedDaysAgo + 3, -1)),
          updatedAt: clock.days(Math.min(spec.bookedDaysAgo + 3, -1)),
        });
      }

      return entries;
    }),
    skipDuplicates: true,
  });

  // Follow-ups drive the dashboard's overdue panel and the high-priority queue,
  // so some are deliberately past due and some are not.
  await client.bookingFollowUp.createMany({
    data: BOOKINGS.filter((spec) => spec.followUpInDays !== null).map((spec) => {
      const overdue = spec.followUpInDays! < 0;
      return {
        id: `demofup${String(spec.index).padStart(3, "0")}00000000000`,
        bookingId: bookingId(spec.index),
        reason:
          spec.ticket === TicketStatus.FAILED
            ? "Ticketing failed at the consolidator — rebook or refund before departure."
            : "Confirm the customer still wants the held fare.",
        priority: spec.priority,
        status: overdue ? FollowUpStatus.IN_PROGRESS : FollowUpStatus.OPEN,
        dueAt: clock.days(spec.followUpInDays!),
        assigneeId: spec.agent,
        createdById: spec.agent,
        lastActionAt: overdue ? clock.days(spec.followUpInDays! - 1) : null,
        lastActionNote: overdue ? "Chased the supplier; no answer yet." : null,
        createdAt: clock.days(spec.bookedDaysAgo + 1),
        updatedAt: clock.days(-1),
      };
    }),
    skipDuplicates: true,
  });
}

/** Payments, refunds, chargebacks and adjustments. */
async function seedMoney(
  client: PrismaClient,
  clock: Clock,
): Promise<{ payments: number; refunds: number; chargebacks: number }> {
  const CARD_BRANDS = ["Visa", "Mastercard", "Amex"];

  // Anything past DRAFT has been charged for; a draft has not.
  const payable = BOOKINGS.filter((b) => b.status !== BookingStatus.DRAFT);

  const payments = payable.flatMap((spec, i) => {
    const total = dollars(spec.total);
    const split = spec.index % 7 === 0;
    const amounts = split
      ? [Math.round(total * 0.6), total - Math.round(total * 0.6)]
      : [total];

    return amounts.map((amount, part) => ({
      id: `demopay${String(spec.index).padStart(3, "0")}${part}0000000000`,
      reference: `PAY-${String(spec.index * 2 + part + 1).padStart(6, "0")}`,
      bookingId: bookingId(spec.index),
      customerId: customerId(spec.customer),
      amountMinor: amount,
      currency: "USD",
      method:
        spec.index % 5 === 0 ? PaymentMethod.BANK_TRANSFER : PaymentMethod.CREDIT_CARD,
      captureMode: PaymentCaptureMode.MANUAL_RECORD,
      status:
        spec.status === BookingStatus.CANCELLED
          ? PaymentStatus.REFUNDED
          : spec.status === BookingStatus.PENDING
            ? PaymentStatus.AUTHORIZED
            : PaymentStatus.CAPTURED,
      provider: null,
      cardLast4: String(4_000 + spec.index * 7 + part).slice(-4),
      cardBrand: CARD_BRANDS[i % CARD_BRANDS.length]!,
      reconciliationStatus:
        i % 4 === 0 ? ReconciliationStatus.UNRECONCILED : ReconciliationStatus.MATCHED,
      reconciledAt: i % 4 === 0 ? null : clock.days(spec.bookedDaysAgo + 3),
      recordedById: spec.index % 3 === 0 ? ELENA : spec.agent,
      capturedAt: clock.days(spec.bookedDaysAgo + 1),
      createdAt: clock.days(spec.bookedDaysAgo + 1),
      updatedAt: clock.days(spec.bookedDaysAgo + 1),
    }));
  });

  await client.payment.createMany({ data: payments, skipDuplicates: true });

  // Refunds across the whole workflow: awaiting approval, approved, completed,
  // rejected and a void — so the refund desk has something to act on and
  // something to read.
  const refundSpecs: {
    booking: number;
    status: RefundStatus;
    kind: RefundKind;
    amount: number;
    reason: string;
    daysAgo: number;
  }[] = [
    { booking: 6, status: RefundStatus.COMPLETED, kind: RefundKind.REFUND, amount: 2215.0, reason: "Booking cancelled within the free-change window.", daysAgo: -20 },
    { booking: 17, status: RefundStatus.PROCESSING, kind: RefundKind.REFUND, amount: 1475.0, reason: "Customer cancelled after a schedule change by the airline.", daysAgo: -5 },
    { booking: 4, status: RefundStatus.PENDING, kind: RefundKind.REFUND, amount: 1960.0, reason: "Ticketing failed; customer requesting a full refund.", daysAgo: -2 },
    { booking: 5, status: RefundStatus.APPROVED, kind: RefundKind.REFUND, amount: 320.0, reason: "Goodwill gesture after a downgraded cabin.", daysAgo: -8 },
    { booking: 10, status: RefundStatus.PENDING, kind: RefundKind.REFUND, amount: 1200.0, reason: "Partial refund requested for an unused leg.", daysAgo: -1 },
    { booking: 13, status: RefundStatus.REJECTED, kind: RefundKind.REFUND, amount: 640.0, reason: "Outside the fare's refund conditions.", daysAgo: -3 },
    { booking: 12, status: RefundStatus.COMPLETED, kind: RefundKind.VOID, amount: 2740.0, reason: "Voided before settlement and rebooked on a lower fare.", daysAgo: -14 },
  ];

  await client.refund.createMany({
    data: refundSpecs.map((spec, i) => {
      const decided =
        spec.status !== RefundStatus.PENDING && spec.status !== RefundStatus.REJECTED;
      return {
        id: `demorfd${String(i).padStart(3, "0")}00000000000000`,
        reference: `RFD-${String(i + 1).padStart(6, "0")}`,
        kind: spec.kind,
        bookingId: bookingId(spec.booking),
        // A draft booking was never charged, so there is no payment to refund
        // against. The column is nullable precisely for this case.
        paymentId: payable.some((b) => b.index === spec.booking)
          ? `demopay${String(spec.booking).padStart(3, "0")}00000000000`
          : null,
        requestedAmountMinor: dollars(spec.amount),
        approvedAmountMinor: decided ? dollars(spec.amount) : null,
        currency: "USD",
        reason: spec.reason,
        status: spec.status,
        requestedById: TOMAS,
        requestedAt: clock.days(spec.daysAgo),
        approvedById:
          spec.status === RefundStatus.PENDING ? null : ELENA,
        approvedAt:
          spec.status === RefundStatus.PENDING ? null : clock.days(spec.daysAgo + 1),
        decisionNote:
          spec.status === RefundStatus.REJECTED
            ? "Fare rules checked with the consolidator; non-refundable."
            : null,
        completedAt:
          spec.status === RefundStatus.COMPLETED ? clock.days(spec.daysAgo + 2) : null,
        createdAt: clock.days(spec.daysAgo),
        updatedAt: clock.days(spec.daysAgo + 1),
      };
    }),
    skipDuplicates: true,
  });

  // Chargebacks with live response deadlines, including one already past its
  // deadline so the overdue treatment is visible.
  const chargebackSpecs: {
    booking: number;
    status: ChargebackStatus;
    amount: number;
    reasonCode: string;
    reason: string;
    receivedDaysAgo: number;
    respondInDays: number | null;
  }[] = [
    { booking: 1, status: ChargebackStatus.EVIDENCE_REQUIRED, amount: 2480.0, reasonCode: "4853", reason: "Cardholder claims services not rendered.", receivedDaysAgo: -6, respondInDays: 3 },
    { booking: 10, status: ChargebackStatus.UNDER_REVIEW, amount: 6120.0, reasonCode: "4837", reason: "Cardholder does not recognise the transaction.", receivedDaysAgo: -19, respondInDays: 8 },
    { booking: 9, status: ChargebackStatus.WON, amount: 880.0, reasonCode: "4855", reason: "Goods or services not provided.", receivedDaysAgo: -64, respondInDays: -34 },
    { booking: 17, status: ChargebackStatus.LOST, amount: 1475.0, reasonCode: "4834", reason: "Duplicate processing alleged.", receivedDaysAgo: -48, respondInDays: -18 },
    { booking: 2, status: ChargebackStatus.EVIDENCE_REQUIRED, amount: 5310.5, reasonCode: "4840", reason: "Fraudulent transaction — card not present.", receivedDaysAgo: -11, respondInDays: -2 },
  ];

  await client.chargeback.createMany({
    data: chargebackSpecs.map((spec, i) => ({
      id: `democbk${String(i).padStart(3, "0")}00000000000000`,
      reference: `CBK-${String(i + 1).padStart(6, "0")}`,
      bookingId: bookingId(spec.booking),
      paymentId: `demopay${String(spec.booking).padStart(3, "0")}00000000000`,
      disputedAmountMinor: dollars(spec.amount),
      currency: "USD",
      reasonCode: spec.reasonCode,
      reason: spec.reason,
      status: spec.status,
      receivedAt: clock.days(spec.receivedDaysAgo),
      respondBy: spec.respondInDays === null ? null : clock.days(spec.respondInDays),
      submittedAt:
        spec.status === ChargebackStatus.WON || spec.status === ChargebackStatus.LOST
          ? clock.days(spec.receivedDaysAgo + 5)
          : null,
      submissionReference:
        spec.status === ChargebackStatus.WON || spec.status === ChargebackStatus.LOST
          ? `SUB-${90_000 + i}`
          : null,
      resolvedAt:
        spec.status === ChargebackStatus.WON || spec.status === ChargebackStatus.LOST
          ? clock.days(spec.receivedDaysAgo + 30)
          : null,
      resolution:
        spec.status === ChargebackStatus.WON
          ? "Evidence accepted; funds retained."
          : spec.status === ChargebackStatus.LOST
            ? "Issuer found for the cardholder; funds debited."
            : null,
      outcomeAmountMinor:
        spec.status === ChargebackStatus.WON
          ? dollars(spec.amount)
          : spec.status === ChargebackStatus.LOST
            ? -dollars(spec.amount)
            : null,
      assignedToId: ELENA,
      createdAt: clock.days(spec.receivedDaysAgo),
      updatedAt: clock.days(-1),
    })),
    skipDuplicates: true,
  });

  await client.financialAdjustment.createMany({
    data: [
      {
        id: "demoadj000000000000000001",
        bookingId: bookingId(2),
        kind: AdjustmentKind.SUPPLIER_DEBIT,
        amountMinor: -dollars(85.0),
        currency: "USD",
        reason: "Consolidator reissue fee not included in the original cost.",
        createdById: ELENA,
        createdAt: clock.days(-5),
      },
      {
        id: "demoadj000000000000000002",
        bookingId: bookingId(5),
        kind: AdjustmentKind.WRITE_OFF,
        amountMinor: -dollars(42.5),
        currency: "USD",
        reason: "Unrecoverable balance below the collection threshold.",
        createdById: ELENA,
        createdAt: clock.days(-22),
      },
      {
        id: "demoadj000000000000000003",
        bookingId: bookingId(16),
        kind: AdjustmentKind.SUPPLIER_CREDIT,
        amountMinor: dollars(130.0),
        currency: "USD",
        reason: "Partner rebate applied for the quarter.",
        createdById: ELENA,
        createdAt: clock.days(-9),
      },
    ],
    skipDuplicates: true,
  });

  return {
    payments: payments.length,
    refunds: refundSpecs.length,
    chargebacks: chargebackSpecs.length,
  };
}

/**
 * Document records, without bytes.
 *
 * The rows point at storage keys that hold nothing: object storage is not
 * configured in a demo, and inventing files to download would be the one place
 * this dataset could mislead. Listing, filtering and verification all work;
 * opening a file reports it missing, which is the truthful outcome.
 */
async function seedDocuments(client: PrismaClient, clock: Clock): Promise<number> {
  const specs = BOOKINGS.filter((spec) => spec.index % 2 === 1).map((spec, i) => ({
    spec,
    i,
    category:
      spec.product === BookingProduct.CRUISE
        ? DocumentCategory.CRUISE_CONFIRMATION
        : spec.ticket === TicketStatus.ISSUED
          ? DocumentCategory.E_TICKET
          : DocumentCategory.BOOKING_CONFIRMATION,
  }));

  await client.document.createMany({
    data: specs.map(({ spec, i, category }) => ({
      id: `demodoc${String(spec.index).padStart(3, "0")}00000000000`,
      category,
      origin: DocumentOrigin.PROVIDER_ISSUED,
      title: `${category.replace(/_/g, " ").toLowerCase()} — MV${70_000 + spec.index}`,
      bookingId: bookingId(spec.index),
      customerId: customerId(spec.customer),
      verificationStatus:
        i % 3 === 0
          ? DocumentVerificationStatus.VERIFIED
          : DocumentVerificationStatus.UNVERIFIED,
      verifiedById: i % 3 === 0 ? NADIA : null,
      verifiedAt: i % 3 === 0 ? clock.days(spec.bookedDaysAgo + 2) : null,
      uploadedById: spec.agent,
      createdAt: clock.days(spec.bookedDaysAgo + 1),
      updatedAt: clock.days(spec.bookedDaysAgo + 1),
    })),
    skipDuplicates: true,
  });

  await client.documentVersion.createMany({
    data: specs.map(({ spec }) => ({
      id: `demodocver${String(spec.index).padStart(3, "0")}000000000`,
      documentId: `demodoc${String(spec.index).padStart(3, "0")}00000000000`,
      version: 1,
      storageKey: `demo/documents/${spec.index}/v1.pdf`,
      fileName: `MV${70_000 + spec.index}-confirmation.pdf`,
      contentType: "application/pdf",
      sizeBytes: 48_000 + spec.index * 1_311,
      uploadedById: spec.agent,
      createdAt: clock.days(spec.bookedDaysAgo + 1),
    })),
    skipDuplicates: true,
  });

  // Pointing the document at its version is a second step: the column is a
  // unique foreign key, so the version has to exist first.
  for (const { spec } of specs) {
    await client.document.update({
      where: { id: `demodoc${String(spec.index).padStart(3, "0")}00000000000` },
      data: {
        currentVersionId: `demodocver${String(spec.index).padStart(3, "0")}000000000`,
      },
    });
  }

  return specs.length;
}

/** Service cases and call activity. */
async function seedOperations(
  client: PrismaClient,
  clock: Clock,
): Promise<{ cases: number; calls: number }> {
  const caseSpecs: {
    booking: number | null;
    customer: number;
    category: string;
    description: string;
    status: ServiceCaseStatus;
    priority: BookingPriority;
    owner: string;
    daysAgo: number;
  }[] = [
    { booking: 4, customer: 3, category: "Ticketing", description: "Ticket never issued and departure is inside a week. Customer wants certainty today.", status: ServiceCaseStatus.IN_PROGRESS, priority: BookingPriority.URGENT, owner: TOMAS, daysAgo: -2 },
    { booking: 2, customer: 1, category: "Schedule change", description: "Airline moved the outbound by six hours; customer needs an alternative.", status: ServiceCaseStatus.OPEN, priority: BookingPriority.HIGH, owner: GRACE, daysAgo: -1 },
    { booking: 3, customer: 2, category: "Cabin request", description: "Requesting a cabin move to a higher deck; checking availability with the line.", status: ServiceCaseStatus.WAITING_ON_CUSTOMER, priority: BookingPriority.NORMAL, owner: GRACE, daysAgo: -6 },
    { booking: 6, customer: 5, category: "Refund", description: "Chasing the refund timeline after cancellation.", status: ServiceCaseStatus.RESOLVED, priority: BookingPriority.NORMAL, owner: TOMAS, daysAgo: -18 },
    { booking: null, customer: 7, category: "Complaint", description: "Unhappy with hold times on the service line. Logged for quality review.", status: ServiceCaseStatus.CLOSED, priority: BookingPriority.LOW, owner: TOMAS, daysAgo: -31 },
    { booking: 10, customer: 9, category: "Billing", description: "Customer disputes the second card charge on a split payment.", status: ServiceCaseStatus.OPEN, priority: BookingPriority.HIGH, owner: TOMAS, daysAgo: -3 },
  ];

  await client.customerServiceCase.createMany({
    data: caseSpecs.map((spec, i) => ({
      id: `democase${String(i).padStart(3, "0")}0000000000000`,
      caseNumber: `CASE-${String(i + 1).padStart(6, "0")}`,
      customerId: customerId(spec.customer),
      bookingId: spec.booking === null ? null : bookingId(spec.booking),
      category: spec.category,
      description: spec.description,
      priority: spec.priority,
      status: spec.status,
      assignedToId: spec.owner,
      resolution:
        spec.status === ServiceCaseStatus.RESOLVED ||
        spec.status === ServiceCaseStatus.CLOSED
          ? "Explained the process and confirmed the timeline with the customer."
          : null,
      resolvedAt:
        spec.status === ServiceCaseStatus.RESOLVED ||
        spec.status === ServiceCaseStatus.CLOSED
          ? clock.days(spec.daysAgo + 4)
          : null,
      createdAt: clock.days(spec.daysAgo),
      updatedAt: clock.days(Math.min(spec.daysAgo + 1, 0)),
    })),
    skipDuplicates: true,
  });

  const OUTCOMES = [
    CallOutcome.CONNECTED,
    CallOutcome.NO_ANSWER,
    CallOutcome.VOICEMAIL,
    CallOutcome.CALLBACK_REQUESTED,
    CallOutcome.BUSY,
  ];

  const calls = BOOKINGS.flatMap((spec, i) => {
    const count = i % 3 === 0 ? 2 : 1;
    return Array.from({ length: count }, (_, leg) => {
      const outcome = OUTCOMES[(i + leg) % OUTCOMES.length]!;
      const connected = outcome === CallOutcome.CONNECTED;
      return {
        id: `democall${String(spec.index).padStart(3, "0")}${leg}000000000`,
        bookingId: bookingId(spec.index),
        customerId: customerId(spec.customer),
        agentId: spec.agent,
        direction: (i + leg) % 2 === 0 ? CallDirection.INBOUND : CallDirection.OUTBOUND,
        outcome,
        occurredAt: clock.hours(-(6 + i * 11 + leg * 3)),
        durationSeconds: connected ? 180 + ((i * 37 + leg * 53) % 900) : null,
        notes: connected
          ? "Walked the customer through the itinerary and confirmed the next step."
          : "No answer; will try again later today.",
        followUpRequired: outcome === CallOutcome.CALLBACK_REQUESTED,
        followUpAt:
          outcome === CallOutcome.CALLBACK_REQUESTED ? clock.hours(18 + i) : null,
        createdAt: clock.hours(-(6 + i * 11 + leg * 3)),
      };
    });
  });

  await client.callRecord.createMany({ data: calls, skipDuplicates: true });

  return { cases: caseSpecs.length, calls: calls.length };
}

/** Internal messaging and outbound notification history. */
async function seedMessaging(
  client: PrismaClient,
  clock: Clock,
  /**
   * The administrator this mail belongs to.
   *
   * These fixtures once addressed a fixed demo account that the embedded
   * database created at boot. There is no such account now, so the sample mail
   * is addressed to whoever is actually signed in — otherwise the inbox would
   * be full of messages for a user that does not exist.
   */
  ownerId: string,
): Promise<{ messages: number }> {
  await client.messageGroup.createMany({
    data: [
      {
        id: "demogroup00000000000001",
        name: "Air desk",
        description: "Everyone working flight bookings.",
        memberIds: [NADIA, MARCUS, ownerId],
        isActive: true,
        updatedAt: new Date(),
      },
      {
        id: "demogroup00000000000002",
        name: "Finance",
        description: "Payments, refunds and chargebacks.",
        memberIds: [ELENA, ownerId],
        isActive: true,
        updatedAt: new Date(),
      },
      {
        id: "demogroup00000000000003",
        name: "Customer care",
        description: "Service cases and inbound calls.",
        memberIds: [TOMAS, GRACE, ownerId],
        isActive: true,
        updatedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  const messageSpecs: {
    subject: string;
    body: string;
    sender: string;
    group: string | null;
    booking: number | null;
    status: MessageStatus;
    daysAgo: number;
    read: boolean;
  }[] = [
    { subject: "Consolidator ticketing delays today", body: "Atlantic are running about four hours behind on issuance. Please warn anyone departing this week before they call us.", sender: NADIA, group: "demogroup00000000000001", booking: null, status: MessageStatus.SENT, daysAgo: -1, read: false },
    { subject: "MV70002 — ticket before 18:00", body: "The held fare on MV70002 reprices at close of business. Escalating because the customer travels in four days.", sender: MARCUS, group: null, booking: 2, status: MessageStatus.SENT, daysAgo: -1, read: false },
    { subject: "Refund queue over threshold", body: "Two refunds are waiting on a SUPER_ADMIN decision because they are above the approval threshold.", sender: ELENA, group: "demogroup00000000000002", booking: null, status: MessageStatus.SENT, daysAgo: -2, read: false },
    { subject: "Chargeback CBK-000005 deadline passed", body: "We are past the response deadline on the Meridian dispute. Please confirm whether evidence went out.", sender: ELENA, group: "demogroup00000000000002", booking: 2, status: MessageStatus.SENT, daysAgo: -2, read: true },
    { subject: "Cruise desk cover on Friday", body: "Grace is out Friday. Cruise enquiries route to the air desk for the day.", sender: GRACE, group: "demogroup00000000000003", booking: null, status: MessageStatus.SENT, daysAgo: -4, read: true },
    { subject: "Draft — quarterly supplier review", body: "Starting the notes for the supplier review. Not ready to send yet.", sender: ownerId, group: null, booking: null, status: MessageStatus.DRAFT, daysAgo: 0, read: false },
    { subject: "Weekly booking summary", body: "Eighteen bookings on file this week, four flagged high or urgent. Details in the booking report.", sender: ownerId, group: "demogroup00000000000001", booking: null, status: MessageStatus.SENT, daysAgo: -6, read: true },
  ];

  await client.message.createMany({
    data: messageSpecs.map((spec, i) => ({
      id: `demomsg${String(i).padStart(3, "0")}000000000000000`,
      subject: spec.subject,
      body: spec.body,
      senderId: spec.sender,
      bookingId: spec.booking === null ? null : bookingId(spec.booking),
      groupId: spec.group,
      status: spec.status,
      sentAt: spec.status === MessageStatus.SENT ? clock.days(spec.daysAgo) : null,
      createdAt: clock.days(spec.daysAgo),
      updatedAt: clock.days(spec.daysAgo),
    })),
    skipDuplicates: true,
  });

  // The demo administrator receives everything they did not send, so the inbox
  // has unread mail on the first visit.
  await client.messageRecipient.createMany({
    data: messageSpecs
      .map((spec, i) => ({ spec, i }))
      .filter(
        ({ spec }) =>
          spec.sender !== ownerId && spec.status === MessageStatus.SENT,
      )
      .map(({ spec, i }) => ({
        id: `demorcp${String(i).padStart(3, "0")}000000000000000`,
        messageId: `demomsg${String(i).padStart(3, "0")}000000000000000`,
        recipientId: ownerId,
        readAt: spec.read ? clock.days(spec.daysAgo + 1) : null,
        createdAt: clock.days(spec.daysAgo),
      })),
    skipDuplicates: true,
  });

  await client.notification.createMany({
    data: BOOKINGS.filter((spec) => spec.status !== BookingStatus.DRAFT)
      .slice(0, 12)
      .map((spec, i) => {
        const customer = CUSTOMERS[spec.customer]!;
        return {
          id: `demontf${String(i).padStart(3, "0")}000000000000000`,
          eventType: `booking.${spec.status.toLowerCase()}`,
          channel: i % 4 === 3 ? NotificationChannel.SMS : NotificationChannel.EMAIL,
          status:
            i % 5 === 4
              ? NotificationStatus.FAILED
              : i % 3 === 0
                ? NotificationStatus.DELIVERED
                : NotificationStatus.SENT,
          dedupeKey: `booking:${bookingId(spec.index)}:${spec.status}`,
          bookingId: bookingId(spec.index),
          recipient:
            i % 4 === 3
              ? `+1 415 555 0${String(100 + spec.customer).padStart(3, "0")}`
              : `${customer.first}.${customer.last}@example.invalid`.toLowerCase(),
          template: `booking-${spec.status.toLowerCase()}`,
          payload: { bookingNumber: `MV${70_000 + spec.index}` },
          attemptCount: i % 5 === 4 ? 3 : 1,
          lastError:
            i % 5 === 4 ? "Mailbox unavailable — retry limit reached." : null,
          sentAt: i % 5 === 4 ? null : clock.days(spec.bookedDaysAgo + 1),
          createdAt: clock.days(spec.bookedDaysAgo + 1),
          updatedAt: clock.days(spec.bookedDaysAgo + 1),
        };
      }),
    skipDuplicates: true,
  });

  return { messages: messageSpecs.length };
}

/**
 * Backfills the audit trail.
 *
 * The audit log is append-only and written by the services as they work, so a
 * fresh database shows an empty page on a screen whose whole purpose is
 * history. These entries describe the records this file created, which is
 * exactly what the real services would have written had a person created them.
 */
async function seedAuditTrail(client: PrismaClient, clock: Clock): Promise<void> {
  await client.auditLog.createMany({
    data: BOOKINGS.flatMap((spec, i) => {
      const entries: Prisma.AuditLogCreateManyInput[] = [
        {
          id: `demoaud${String(spec.index).padStart(3, "0")}a0000000000`,
          action: AuditAction.CREATE,
          entityType: "Booking",
          entityId: bookingId(spec.index),
          adminUserId: spec.agent,
          summary: `Created booking MV${70_000 + spec.index}`,
          changes: { status: { after: BookingStatus.DRAFT } },
          ipAddress: "203.0.113.24",
          userAgent: "Mozilla/5.0 (demo)",
          createdAt: clock.days(spec.bookedDaysAgo),
        },
      ];

      if (spec.status !== BookingStatus.DRAFT) {
        entries.push({
          id: `demoaud${String(spec.index).padStart(3, "0")}b0000000000`,
          action: AuditAction.STATUS_CHANGE,
          entityType: "Booking",
          entityId: bookingId(spec.index),
          adminUserId: spec.agent,
          summary: `MV${70_000 + spec.index} moved to ${spec.status}`,
          changes: {
            status: { before: BookingStatus.PENDING, after: spec.status },
          },
          ipAddress: "203.0.113.24",
          userAgent: "Mozilla/5.0 (demo)",
          createdAt: clock.days(spec.bookedDaysAgo + 1),
        });
      }

      if (i % 4 === 0) {
        entries.push({
          id: `demoaud${String(spec.index).padStart(3, "0")}c0000000000`,
          action: AuditAction.APPROVE,
          entityType: "Payment",
          entityId: `demopay${String(spec.index).padStart(3, "0")}00000000000`,
          adminUserId: ELENA,
          summary: `Reconciled payment for MV${70_000 + spec.index}`,
          changes: {
            reconciliationStatus: {
              before: ReconciliationStatus.UNRECONCILED,
              after: ReconciliationStatus.MATCHED,
            },
          },
          ipAddress: "203.0.113.31",
          userAgent: "Mozilla/5.0 (demo)",
          createdAt: clock.days(spec.bookedDaysAgo + 3),
        });
      }

      return entries;
    }),
    skipDuplicates: true,
  });
}

/**
 * Moves the reference counters past the fixtures.
 *
 * Booking numbers, customer references and the rest are drawn from the
 * `ReferenceSequence` counters, which know nothing about rows inserted here
 * with explicit values. Left alone, the next booking created through the UI
 * would be handed MV70001 — which this file already used — and fail on the
 * unique constraint.
 *
 * `GREATEST` rather than a plain assignment: a database that has already
 * issued numbers beyond these must not have its counter wound backwards onto
 * values that are taken.
 */
async function alignReferenceSequences(client: PrismaClient): Promise<void> {
  const highest = {
    booking_number: 70_000 + BOOKINGS.length,
    customer_reference: 100_000 + CUSTOMERS.length,
    payment_reference: BOOKINGS.length * 2 + 2,
    refund_reference: 32,
    chargeback_reference: 32,
    service_case: 32,
  };

  for (const [kind, value] of Object.entries(highest)) {
    await client.$executeRaw`
      UPDATE \`ReferenceSequence\`
      SET \`value\` = GREATEST(\`value\`, ${value}), \`updatedAt\` = NOW(3)
      WHERE \`kind\` = ${kind}
    `;
  }
}

/** The boot instant, reused wherever a row needs "updated just now". */
function now_(clock: Clock): Date {
  return clock.days(0);
}
