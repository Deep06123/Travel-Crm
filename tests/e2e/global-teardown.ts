/**
 * Runs once after every spec file.
 *
 * The fixture pool is shared across files, so it must not be closed by an
 * individual spec's afterAll — the next file would then find it ended. Final
 * cleanup and shutdown belong here.
 *
 * `fixtures` is imported lazily rather than at module load. It opens a pool
 * against DATABASE_URL and throws without one, which would fail the whole run
 * for specs that never touch it — the demo-mode specs drive the embedded
 * database through the browser and need no fixtures at all.
 */
export default async function globalTeardown(): Promise<void> {
  if (!process.env["DATABASE_URL"]) return;

  const { cleanupFixtures, closeFixtures } = await import("./fixtures");

  await cleanupFixtures();
  await closeFixtures();
}
