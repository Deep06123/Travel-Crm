/**
 * Translation between the two spellings of the same connection.
 *
 * Prisma's CLI — migrate, studio, seed — requires the `mysql://` scheme its
 * provider declares. The mariadb driver underneath parses only `mariadb://`
 * and rejects anything else outright, so it cannot be handed `DATABASE_URL`
 * directly. Rather than keep two environment variables that must agree, the
 * single `mysql://` URL is decomposed here into the options object the driver
 * also accepts.
 *
 * Deliberately free of `server-only` and of any import from `@/lib/env`: the
 * seed script and the password-reset tool run outside Next.js and need this
 * too, and a module they cannot import would mean a second copy of it.
 */

export interface MysqlPoolConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  acquireTimeout: number;
  connectTimeout: number;
  prepareCacheLength: number;
  ssl?: true;
  cachingRsaPublicKey?: string;
  allowPublicKeyRetrieval?: boolean;
}

export interface MysqlPoolOptions {
  /** Connections held by this pool. */
  connectionLimit: number;
  /**
   * How long to wait for a connection or a handshake, in milliseconds.
   *
   * Without a bound, a request that finds the pool saturated waits forever and
   * a serverless platform kills the function with no explanation. A timeout
   * turns that into an error naming the real cause.
   */
  timeoutMs?: number;
}

/**
 * Builds driver pool settings from a `mysql://` URL.
 *
 * Only the parameters the application actually uses are carried across.
 * `?ssl=true` and `?sslaccept=strict` — the spellings Prisma documents for
 * MySQL — turn on TLS; a provider needing a custom CA wants an `ssl` object
 * assembled by the caller rather than a query parameter.
 *
 * MySQL 8 defaults new accounts to `caching_sha2_password`. Once the server's
 * credential cache goes cold — a restart, or an account that has never
 * authenticated — the next handshake falls back to RSA, and a client holding
 * neither the server's public key nor permission to ask for it cannot complete
 * it. That surfaces as "pool failed to retrieve a connection from pool" with
 * the real cause buried underneath, so two opt-ins are carried across:
 *
 *   ?cachingRsaPublicKey=/var/lib/mysql/public_key.pem   preferred
 *   ?allowPublicKeyRetrieval=true                        loopback only
 *
 * The first pins the key from disk. The second asks the server for it over the
 * unencrypted channel, which a man-in-the-middle could answer with its own key
 * and so recover the password — acceptable when the connection never leaves
 * the host, not otherwise. Neither is needed once TLS is on: an encrypted
 * channel carries the password directly and RSA never enters into it.
 */
export function mysqlPoolConfig(
  databaseUrl: string,
  { connectionLimit, timeoutMs = 10_000 }: MysqlPoolOptions,
): MysqlPoolConfig {
  const url = new URL(databaseUrl);
  const ssl = url.searchParams.get("ssl");
  const sslAccept = url.searchParams.get("sslaccept");
  const rsaPublicKey = url.searchParams.get("cachingRsaPublicKey");
  const allowKeyRetrieval = url.searchParams.get("allowPublicKeyRetrieval");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    // The URL form percent-encodes anything awkward in a password, and a
    // generated database password routinely contains such characters.
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    // A leading slash is part of the URL, never part of the schema name.
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    connectionLimit,
    acquireTimeout: timeoutMs,
    connectTimeout: timeoutMs,

    /**
     * Prepared statements kept per connection.
     *
     * Set explicitly because the Prisma adapter forces this to 0 on any pool
     * it builds itself, and the driver's own default of 256 never applies.
     * With no cache every query costs three round trips — PREPARE, EXECUTE,
     * CLOSE — instead of one, which on a page issuing thirty queries is sixty
     * needless round trips. The application has a small, fixed set of query
     * shapes, so they all stay cached after the first use of each.
     */
    prepareCacheLength: 256,
    ...(ssl === "true" || sslAccept === "strict" ? { ssl: true as const } : {}),
    ...(rsaPublicKey ? { cachingRsaPublicKey: rsaPublicKey } : {}),
    ...(allowKeyRetrieval === "true" ? { allowPublicKeyRetrieval: true } : {}),
  };
}
