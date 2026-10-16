import { IncomingMessage, ServerResponse, type Server } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";

/** Exercise the real request listener without opening a port (restricted CI). */
export async function requestInProcess(
  server: Server,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    const req = new IncomingMessage(socket as Socket);
    req.method = init.method ?? "GET";
    req.url = target.pathname + target.search;
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;
    req.headers = {
      host: target.host,
      ...Object.fromEntries(new Headers(init.headers)),
    };
    const res = new ServerResponse(req);
    res.assignSocket(socket as Socket);
    res.on("error", reject);
    res.on("finish", () => {
      const raw = Buffer.concat(chunks);
      const body = raw.subarray(raw.indexOf("\r\n\r\n") + 4);
      resolve(
        new Response(new Uint8Array(body), {
          status: res.statusCode,
          headers: Object.fromEntries(
            Object.entries(res.getHeaders()).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        }),
      );
      socket.destroy();
    });
    if (init.body) req.push(Buffer.from(init.body.toString()));
    req.complete = true;
    req.push(null);
    server.emit("request", req, res);
  });
}
