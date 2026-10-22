import { createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";

/**
 * A minimal SMTP server that accepts mail and keeps it in memory.
 *
 * Deliberately a real server rather than a mocked transport. Mocking
 * `nodemailer.sendMail` would prove only that the service calls a function;
 * this proves an actual SMTP conversation completes — EHLO, MAIL FROM, RCPT
 * TO, DATA, QUIT — and lets the test read the bytes that were really put on
 * the wire, including the headers nodemailer generates and the encoding it
 * chooses for the body.
 *
 * It implements just enough of RFC 5321 for nodemailer's happy path. It is a
 * test fixture, not a mail server.
 */

export interface CapturedMail {
  from: string;
  recipients: string[];
  /** Raw message, headers and body, with dot-unstuffing applied. */
  data: string;
}

export class SmtpSink {
  readonly messages: CapturedMail[] = [];

  private server: Server | undefined;
  private sockets = new Set<Socket>();

  /** Set to make every RCPT TO fail, exercising the FAILED path. */
  rejectRecipients = false;

  async start(): Promise<number> {
    this.server = createServer((socket) => this.handle(socket));

    // Port 0 asks the OS for a free port, so concurrent runs cannot collide.
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");

    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("SMTP sink did not bind a TCP port.");
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
    this.messages.length = 0;
    this.rejectRecipients = false;
  }

  /** Returns the single captured message, failing loudly if that is not true. */
  only(): CapturedMail {
    if (this.messages.length !== 1) {
      throw new Error(
        `Expected exactly one captured message, found ${this.messages.length}.`,
      );
    }
    return this.messages[0]!;
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    // A destroyed socket on teardown must not crash the test run.
    socket.on("error", () => void 0);

    let buffer = "";
    let inData = false;
    let dataLines: string[] = [];
    let from = "";
    let recipients: string[] = [];

    socket.write("220 smtp-sink ready\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      // SMTP is line-oriented on CRLF; a chunk may hold part of a line or many.
      let index: number;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            this.messages.push({
              from,
              recipients: [...recipients],
              data: dataLines.join("\r\n"),
            });
            dataLines = [];
            from = "";
            recipients = [];
            socket.write("250 2.0.0 Ok: queued\r\n");
            continue;
          }

          // Dot-stuffing: a body line starting "." is sent as "..".
          dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }

        const upper = line.toUpperCase();

        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          // No AUTH and no STARTTLS advertised, so nodemailer sends in the
          // clear — correct for a loopback sink and keeps the fixture small.
          socket.write("250-smtp-sink\r\n250 8BITMIME\r\n");
        } else if (upper.startsWith("MAIL FROM")) {
          from = extractAddress(line);
          socket.write("250 2.1.0 Ok\r\n");
        } else if (upper.startsWith("RCPT TO")) {
          if (this.rejectRecipients) {
            socket.write("550 5.1.1 No such recipient here\r\n");
          } else {
            recipients.push(extractAddress(line));
            socket.write("250 2.1.5 Ok\r\n");
          }
        } else if (upper.startsWith("DATA")) {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (upper.startsWith("QUIT")) {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else if (upper.startsWith("RSET")) {
          from = "";
          recipients = [];
          socket.write("250 2.0.0 Ok\r\n");
        } else {
          socket.write("250 2.0.0 Ok\r\n");
        }
      }
    });
  }
}

function extractAddress(line: string): string {
  const match = /<([^>]*)>/.exec(line);
  return match?.[1] ?? line.split(":").slice(1).join(":").trim();
}

/**
 * Decodes a quoted-printable body.
 *
 * nodemailer encodes anything non-ASCII this way, and the templates contain an
 * arrow (→) and an em dash, so a test asserting on readable text has to decode
 * first or it will compare against `=E2=86=92`.
 */
export function decodeQuotedPrintable(input: string): string {
  const unfolded = input.replace(/=\r\n/g, "");
  const bytes: number[] = [];

  for (let i = 0; i < unfolded.length; i += 1) {
    if (unfolded[i] === "=" && i + 2 < unfolded.length) {
      const hex = unfolded.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(unfolded.charCodeAt(i));
  }

  return Buffer.from(bytes).toString("utf8");
}
