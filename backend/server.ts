import { WebSocketServer } from "ws";
import express, { type Express } from "express";
import { createServer } from "http";

export const app: Express = express();
export const server = createServer(app);
export const wss = new WebSocketServer({
  server,
  path: "/socket",
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1 },       // Fastest compression
    threshold: 128,                          // Only compress messages > 128 bytes
    concurrencyLimit: 10,
  },
  maxPayload: 1024,                          // Reject huge payloads from clients
});
