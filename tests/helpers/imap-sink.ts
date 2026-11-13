import { createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";

/**
 * A minimal IMAP server that accepts APPEND and keeps what it was given.
 *
 * The counterpart to `SmtpSink`, and a real server for the same reason:
 * mocking the IMAP client would prove only that we call a function. The point
 * of saving to Sent is that a *server* accepts the message, into the folder it
 * calls Sent, carrying the flags a mail client would set — and none of that is
 * observable through a mock.
 *
 * It implements just enough of RFC 3501 for imapflow's connect-and-append
 * path: a greeting, CAPABILITY, LOGIN, LIST with SPECIAL-USE flags, APPEND
 * with a literal, and LOGOUT. It is a test fixture, not a mail server.
 */

export interface CapturedAppend {
  mailbox: string;
  flags: string[];
  /** The exact bytes the client appended. */
  message: string;
}

/** The folder layout a provider like Hostinger presents: Sent under INBOX. */
const MAILBOXES: { path: string; specialUse?: string }[] = [
  { path: "INBOX" },
  { path: "INBOX.Drafts", specialUse: "\\Drafts" },
  { path: "INBOX.Sent", specialUse: "\\Sent" },
  { path: "INBOX.Trash", specialUse: "\\Trash" },
];

export class ImapSink {
  readonly appends: CapturedAppend[] = [];

  /** Credentials the sink will accept. Anything else gets NO. */
  user = "mailbox@example.invalid";
  password = "a-password";

  /** Set to refuse every APPEND, exercising the "copy failed" path. */
  rejectAppend = false;

  /** Set to accept nothing at all, exercising a mailbox that will not sign in. */
  rejectLogin = false;

  /**
   * Set to take an APPEND and never answer it.
   *
   * A refused copy fails fast; a mailbox that goes quiet mid-upload is the one
   * that used to hold a send open until the append timed out.
   */
  stallAppend = false;

  /** Counts connections, so a test can prove none was opened. */
  connections = 0;

  private server: Server | undefined;
  private sockets = new Set<Socket>();

  async start(): Promise<number> {
    this.server = createServer((socket) => this.handle(socket));

    // Port 0 asks the OS for a free port, so concurrent runs cannot collide.
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");

    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("IMAP sink did not bind a TCP port.");
    }

    return address.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();

    if (!this.server) return;
    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  reset(): void {
    this.appends.length = 0;
    this.rejectAppend = false;
    this.rejectLogin = false;
    this.stallAppend = false;
    this.connections = 0;
  }

  only(): CapturedAppend {
    if (this.appends.length !== 1) {
      throw new Error(
        `Expected exactly one appended message, found ${this.appends.length}.`,
      );
    }
    return this.appends[0]!;
  }

  private handle(socket: Socket): void {
    this.connections += 1;
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => void 0);

    let buffer = Buffer.alloc(0);

    // Set while a literal is in flight: APPEND sends its size, waits for a
    // continuation, then sends raw bytes that are not line-delimited and may
    // themselves contain CRLF. Reading those as commands is the one way a
    // line-oriented parser gets IMAP wrong.
    let pending:
      | { tag: string; mailbox: string; flags: string[]; remaining: number; chunks: Buffer[] }
      | undefined;

    // No STARTTLS and no AUTH= advertised, so imapflow uses LOGIN in the
    // clear — correct for a loopback sink and keeps the fixture small.
    socket.write("* OK [CAPABILITY IMAP4rev1 SPECIAL-USE] imap-sink ready\r\n");

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        if (pending) {
          if (buffer.length < pending.remaining) return;

          pending.chunks.push(buffer.subarray(0, pending.remaining));
          buffer = buffer.subarray(pending.remaining);

          const append = pending;
          pending = undefined;

          if (this.stallAppend) {
            // Deliberately no response: the client waits for its own timeout.
            return;
          }

          if (this.rejectAppend) {
            socket.write(`${append.tag} NO [CANNOT] Append refused\r\n`);
          } else {
            this.appends.push({
              mailbox: append.mailbox,
              flags: append.flags,
              message: Buffer.concat(append.chunks).toString("utf8"),
            });
            socket.write(`${append.tag} OK [APPENDUID 1 1] APPEND completed\r\n`);
          }

          // The trailing CRLF after the literal, which is not part of it.
          if (buffer.subarray(0, 2).toString() === "\r\n") buffer = buffer.subarray(2);
          continue;
        }

        const index = buffer.indexOf("\r\n");
        if (index === -1) return;

        const line = buffer.subarray(0, index).toString("utf8");
        buffer = buffer.subarray(index + 2);

        const literal = this.dispatch(socket, line);
        if (literal) pending = literal;
      }
    });
  }

  /** Handles one command line; returns a literal to collect, if any. */
  private dispatch(socket: Socket, line: string): undefined | {
    tag: string;
    mailbox: string;
    flags: string[];
    remaining: number;
    chunks: Buffer[];
  } {
    const [tag = "*", rawCommand = "", ...rest] = line.split(" ");
    const command = rawCommand.toUpperCase();

    switch (command) {
      case "CAPABILITY":
        socket.write("* CAPABILITY IMAP4rev1 SPECIAL-USE\r\n");
        socket.write(`${tag} OK CAPABILITY completed\r\n`);
        return undefined;

      case "LOGIN": {
        const [user, password] = rest.map(unquote);

        if (this.rejectLogin || user !== this.user || password !== this.password) {
          socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
          return undefined;
        }

        socket.write(`${tag} OK [CAPABILITY IMAP4rev1 SPECIAL-USE] Logged in\r\n`);
        return undefined;
      }

      case "LIST": {
        // `LIST "" ""` is the delimiter probe clients send before anything
        // else; it must answer with the hierarchy separator and nothing more.
        if (unquote(rest[1] ?? "") === "") {
          socket.write('* LIST (\\Noselect) "." ""\r\n');
          socket.write(`${tag} OK LIST completed\r\n`);
          return undefined;
        }

        for (const box of MAILBOXES) {
          const flags = box.specialUse ? `(${box.specialUse})` : "()";
          socket.write(`* LIST ${flags} "." "${box.path}"\r\n`);
        }
        socket.write(`${tag} OK LIST completed\r\n`);
        return undefined;
      }

      case "APPEND": {
        const sizeMatch = /\{(\d+)\+?\}$/.exec(line);
        const flagsMatch = /\(([^)]*)\)/.exec(line);

        if (!sizeMatch) {
          socket.write(`${tag} BAD APPEND needs a literal\r\n`);
          return undefined;
        }

        socket.write("+ Ready for literal data\r\n");

        return {
          tag,
          mailbox: unquote(rest[0] ?? ""),
          flags: (flagsMatch?.[1] ?? "").split(" ").filter(Boolean),
          remaining: Number(sizeMatch[1]),
          chunks: [],
        };
      }

      case "LOGOUT":
        socket.write("* BYE Logging out\r\n");
        socket.write(`${tag} OK LOGOUT completed\r\n`);
        socket.end();
        return undefined;

      default:
        // NOOP, ID, ENABLE, SELECT and anything else imapflow tries on the way
        // in. Answering OK keeps the fixture to the path under test.
        socket.write(`${tag} OK ${command} completed\r\n`);
        return undefined;
    }
  }
}

function unquote(value: string): string {
  return value.replace(/^"/, "").replace(/"$/, "");
}
