import type { Socket } from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { bindEnds } from "./fence-splice";
import { headEnd, MAX_HEAD_BYTES } from "./fence-wire";

const HOP_BY_HOP = /^(connection|keep-alive|proxy-connection)$/i;

/**
 * Relay exactly ONE plain-http request (its rewritten head and `bodyLength`
 * body bytes), then the site's response, then close. The fence judged only
 * this request's host: any further byte the browser sends on the connection
 * (a second, kept-alive request, maybe to another host) is never relayed; the
 * connection is cut instead. The response says `Connection: close`, so a
 * browser opens a new proxy connection, and a new judgment, per request.
 */
export function relayOne(
  client: Socket,
  upstream: Socket,
  head: Buffer,
  bodyLength: number,
  rest: Buffer,
): void {
  const cut = bindEnds(client, upstream);
  let left = bodyLength;
  let draining = false;
  const take = (chunk: Buffer): boolean => {
    if (chunk.length > left) {
      cut();
      return false;
    }
    left -= chunk.length;
    if (chunk.length > 0 && !upstream.write(chunk) && !draining) {
      draining = true;
      client.pause();
      upstream.once("drain", () => {
        draining = false;
        client.resume();
      });
    }
    return true;
  };
  upstream.write(head);
  if (!take(rest)) return;
  client.on("data", take);
  const response = closingResponse();
  response.on("error", cut);
  upstream.pipe(response).pipe(client);
  // A first body chunk that filled the site's buffer paused the browser: it
  // reads on at "drain", not before, or the body would pile up in memory.
  if (!draining) client.resume();
}

/**
 * The site's response with every head (1xx ones, then the final one) saying
 * `Connection: close` in place of whatever keep-alive it offered; the body
 * passes through untouched. A head past {@link MAX_HEAD_BYTES} is an error.
 */
function closingResponse(): Transform {
  let pending = Buffer.alloc(0);
  let inBody = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      if (inBody) return done(null, chunk);
      pending = Buffer.concat([pending, chunk]);
      const out: Buffer[] = [];
      for (let end = headEnd(pending); end !== -1; end = headEnd(pending)) {
        const head = pending.subarray(0, end).toString("latin1");
        pending = pending.subarray(end);
        out.push(Buffer.from(closeHead(head), "latin1"));
        if (!/^HTTP\/1\.[01] 1\d\d[ \r]/.test(head)) {
          inBody = true;
          out.push(pending);
          pending = Buffer.alloc(0);
          break;
        }
      }
      if (!inBody && pending.length > MAX_HEAD_BYTES)
        return done(new Error("response head too large"));
      done(null, Buffer.concat(out));
    },
  });
}

function closeHead(head: string): string {
  const [status = "", ...fields] = head.slice(0, -4).split("\r\n");
  const kept = fields.filter(
    (f) => !HOP_BY_HOP.test(f.slice(0, f.indexOf(":")).trim()),
  );
  return [status, ...kept, "Connection: close", "", ""].join("\r\n");
}
