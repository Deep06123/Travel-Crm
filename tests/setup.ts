import "dotenv/config";

/**
 * Loads `.env` before any test module reads configuration.
 *
 * Integration tests run against the real development database rather than a
 * mock, so that foreign keys, unique constraints and transaction behaviour are
 * actually exercised — a mocked Prisma client would pass whatever it was told.
 */
