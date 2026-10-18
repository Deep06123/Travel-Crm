import { cleanupFixtures, closeFixtures } from "./fixtures";

/**
 * Runs once after every spec file.
 *
 * The fixture pool is shared across files, so it must not be closed by an
 * individual spec's afterAll — the next file would then find it ended. Final
 * cleanup and shutdown belong here.
 */
export default async function globalTeardown(): Promise<void> {
  await cleanupFixtures();
  await closeFixtures();
}
