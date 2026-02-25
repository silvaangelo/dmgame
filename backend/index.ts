import express from "express";
import path from "path";
import compression from "compression";
import { app, server } from "./server.js";
import { setupSocket } from "./socket.js";
import { startGameLoop } from "./game.js";
import { initDatabase } from "./database.js";

const PORT = Number(process.env.PORT) || 3000;

/* ================= MIDDLEWARE ================= */

app.use(compression());

/* ================= STATIC FILES ================= */

const frontendDir = path.join(process.cwd(), "frontend");

// Cache audio/image assets for 1 hour, HTML/JS/CSS for 10 seconds (dev-friendly)
app.use("/assets", express.static(path.join(frontendDir, "assets"), {
  maxAge: "1h",
  immutable: true,
}));
app.use(express.static(frontendDir, {
  maxAge: "10s",
  etag: true,
}));

// SPA fallback — any non-file route returns index.html
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

/* ================= STARTUP ================= */

initDatabase();
setupSocket();
startGameLoop();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
  console.log(`Frontend available at http://localhost:${PORT}/`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/socket`);
});
