import http, { IncomingMessage, ServerResponse } from 'http';

export interface RouteHandler {
  (req: IncomingMessage, res: ServerResponse): void;
}

export interface TargetServer {
  server: http.Server;
  port: number;
}

export function startTargetServer(routes?: Record<string, RouteHandler>): Promise<TargetServer> {
  const defaultRoutes: Record<string, RouteHandler> = {
    '/api/user': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 1, name: 'Alice' }));
    },
    '/api/items': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 1, item: 'laptop' }, { id: 2, item: 'phone' }]));
    },
    '/api/echo': (req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-echo-method': req.method || '',
        });
        res.end(JSON.stringify({ method: req.method, body, url: req.url }));
      });
    },
    '/api/status-error': (req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    },
    '/api/headers': (req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'x-custom-header': 'from-target',
      });
      res.end('headers test');
    },
  };

  const mergedRoutes = { ...defaultRoutes, ...routes };

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const handler = mergedRoutes[url.pathname];

    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`target: ${req.url}`);
    }
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' ? address!.port : 0;
      resolve({ server, port });
    });
  });
}

export function stopTargetServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
