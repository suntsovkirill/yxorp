import { IncomingMessage } from 'http';

/**
 * Gives a mock script fetch-style body readers — `await req.json()`,
 * `await req.text()`, `await req.buffer()`. The body is read lazily, only
 * when one of them is called, and only once; a script that reads the request
 * stream itself (`req.on('data', ...)`) keeps working as before.
 */
export function attachBodyReaders(req: IncomingMessage): void {
  let body: Promise<Buffer> | undefined;

  req.buffer = () => {
    // Already read (for `match.body`)? Then the stream is drained — reuse it.
    body ??= req.proxyBody ? Promise.resolve(req.proxyBody) : readRequestBody(req);
    return body;
  };
  req.text = async () => (await req.buffer!()).toString('utf-8');
  req.json = async () => JSON.parse(await req.text!());
}

/** Reads the whole request body; also keeps it as `req.requestBody`. */
export function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      req.requestBody = Buffer.concat(chunks);
      resolve(req.requestBody);
    });
    req.on('error', reject);
  });
}
