import { describe, expect, it } from "vitest";

import { mysqlPoolConfig } from "@/lib/db/mysql-url";

/**
 * Translating a `mysql://` URL into driver pool options.
 *
 * The RSA cases exist because getting them wrong takes the whole application
 * down rather than degrading it: MySQL 8 defaults accounts to
 * `caching_sha2_password`, and a client that can neither read the server's
 * public key nor ask for it cannot complete the handshake once the server's
 * credential cache goes cold. The driver reports that as a pool timeout, which
 * names the symptom and hides the cause, so the behaviour is pinned here.
 */

const LOOPBACK = "mysql://user:pass@127.0.0.1:3306/travel_crm";
const REMOTE = "mysql://user:pass@db.example.com:3306/travel_crm";

const config = (url: string) => mysqlPoolConfig(url, { connectionLimit: 2 });

describe("mysqlPoolConfig", () => {
  it("decomposes the URL into driver options", () => {
    expect(config(LOOPBACK)).toMatchObject({
      host: "127.0.0.1",
      port: 3306,
      user: "user",
      password: "pass",
      database: "travel_crm",
      connectionLimit: 2,
    });
  });

  it("defaults the port when the URL omits it", () => {
    expect(config("mysql://user:pass@db.example.com/travel_crm").port).toBe(3306);
  });

  it("decodes a percent-encoded password", () => {
    // Generated database passwords routinely contain characters that only
    // survive the URL form encoded.
    expect(config("mysql://user:p%40ss%3Aword@127.0.0.1:3306/db").password).toBe(
      "p@ss:word",
    );
  });

  describe("TLS", () => {
    it("enables it for ?ssl=true", () => {
      expect(config(`${REMOTE}?ssl=true`).ssl).toBe(true);
    });

    it("enables it for ?sslaccept=strict", () => {
      expect(config(`${REMOTE}?sslaccept=strict`).ssl).toBe(true);
    });

    it("leaves it off by default", () => {
      expect(config(REMOTE).ssl).toBeUndefined();
    });
  });

  describe("public key retrieval", () => {
    it("is on by default over loopback, where there is no segment to intercept", () => {
      expect(config(LOOPBACK).allowPublicKeyRetrieval).toBe(true);
      expect(config("mysql://user:pass@localhost:3306/db").allowPublicKeyRetrieval).toBe(
        true,
      );
      expect(config("mysql://user:pass@[::1]:3306/db").allowPublicKeyRetrieval).toBe(true);
    });

    it("is off by default to any other host", () => {
      // Off the loopback the key request crosses a network a third party could
      // answer with its own key, which would hand them the password.
      expect(config(REMOTE).allowPublicKeyRetrieval).toBeUndefined();
    });

    it("is not needed once TLS carries the password", () => {
      expect(config(`${LOOPBACK}?ssl=true`).allowPublicKeyRetrieval).toBeUndefined();
    });

    it("gives way to an explicitly pinned key", () => {
      const pinned = config(`${LOOPBACK}?cachingRsaPublicKey=/var/lib/mysql/public_key.pem`);
      expect(pinned.cachingRsaPublicKey).toBe("/var/lib/mysql/public_key.pem");
      expect(pinned.allowPublicKeyRetrieval).toBeUndefined();
    });

    it("honours an explicit opt-out over loopback", () => {
      expect(config(`${LOOPBACK}?allowPublicKeyRetrieval=false`).allowPublicKeyRetrieval)
        .toBeUndefined();
    });

    it("honours an explicit opt-in to a remote host", () => {
      expect(config(`${REMOTE}?allowPublicKeyRetrieval=true`).allowPublicKeyRetrieval).toBe(
        true,
      );
    });
  });
});
