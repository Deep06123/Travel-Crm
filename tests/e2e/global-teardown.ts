/**
 * Runs once after every spec file.
 *
 * The fixture pool is shared across files, so it must not be closed by an
 * individual spec's afterAll — the next file would then find it ended. Final
 * cleanup and shutdown belong here.
 *
 * `fixtures` is imported lazily rather than at module load. It opens a pool
 * against DATABASE_URL and throws without one, so importing it eagerly would
 * fail the whole run with a configuration error rather than the clear skip
 * below.
 */
export default async function globalTeardown(): Promise<void> {
  if (!process.env["DATABASE_URL"]) return;

  const { cleanupFixtures, closeFixtures } = await import("./fixtures");

  await cleanupFixtures();
  await closeFixtures();
}
