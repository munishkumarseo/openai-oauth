import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeCore } from './bridge-core.js';
import { bridgeHtml } from './frontend.js';
import type { BridgeResult, ScriptBridge } from './script-runtime.js';

export class WsPhotopeaBridge implements ScriptBridge {
  private readonly core: BridgeCore;
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private port = 0;
  private activeClient: WebSocket | null = null;

  constructor(timeoutMs = 60_000) {
    this.core = new BridgeCore({ timeoutMs });
    this.httpServer = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'; frame-src https://www.photopea.com; script-src 'unsafe-inline'; connect-src 'self' ws:; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        });
        res.end(bridgeHtml());
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (client) => this.attach(client));
  }

  get url(): string {
    if (!this.port) throw new Error('Photopea bridge has not started');
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.port) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.httpServer.once('error', onError);
      this.httpServer.listen(0, '127.0.0.1', () => {
        this.httpServer.off('error', onError);
        const address = this.httpServer.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not determine Photopea bridge port'));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  waitForReady(): Promise<void> {
    return this.core.waitForReady();
  }

  executeScript(script: string): Promise<BridgeResult> {
    return this.core.executeScript(script);
  }

  async close(): Promise<void> {
    await this.core.close();
    if (this.activeClient) {
      this.activeClient.terminate();
      this.activeClient = null;
    }
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    if (this.httpServer.listening) {
      await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
    }
    this.port = 0;
  }

  private attach(client: WebSocket): void {
    if (this.activeClient && this.activeClient !== client) {
      this.activeClient.terminate();
    }
    this.activeClient = client;
    this.core.attachClient((payload) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
    client.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        this.core.handleClientMessage(message);
      } catch {
        // Ignore malformed browser messages.
      }
    });
    client.on('close', () => {
      if (this.activeClient === client) {
        this.activeClient = null;
        this.core.detachClient();
      }
    });
  }
}
