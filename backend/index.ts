import express from "express";
import path from "path";
import compression from "compression";
import { app, server } from "./server.js";
import { setupSocket } from "./socket.js";
import { startGameLoop, initPersistentGame } from "./game.js";
import { initDatabase } from "./database.js";

const PORT = Number(process.env.PORT) || 3000;

/* ================= MIDDLEWARE ================= */

app.use(compression());
app.use(express.json({ limit: "1kb" }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

/* ================= STATIC FILES ================= */

const frontendDir = path.join(process.cwd(), "frontend");
const isProd = process.env.NODE_ENV === "production";

// Cache audio/image assets for 1 day (immutable), HTML/JS/CSS depends on env
app.use("/assets", express.static(path.join(frontendDir, "assets"), {
  maxAge: isProd ? "7d" : "1h",
  immutable: true,
}));
app.use(express.static(frontendDir, {
  maxAge: isProd ? "1h" : "10s",
  etag: true,
}));

/* ================= API ROUTES ================= */

// SPA fallback — any non-file route returns index.html
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

/* ================= STARTUP ================= */

initDatabase();
setupSocket();
startGameLoop();
initPersistentGame();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
  console.log(`Frontend available at http://localhost:${PORT}/`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/socket`);
});
