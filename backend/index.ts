import express from "express";
import path from "path";
import compression from "compression";
import { app, server } from "./server.js";
import { setupSocket } from "./socket.js";
import { startGameLoop } from "./game.js";
import { initDatabase, registerUser, getUserByToken } from "./database.js";

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

// Register or re-register a username
app.post("/api/register", (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "Username é obrigatório." });
    return;
  }

  const trimmed = username.trim();
  const usernamePattern = /^[a-zA-Z0-9_]+$/;
  if (trimmed.length < 2 || trimmed.length > 16 || !usernamePattern.test(trimmed)) {
    res.status(400).json({ error: "Username deve ter 2-16 caracteres (letras, números, _)." });
    return;
  }

  const user = registerUser(trimmed);

  if (!user) {
    res.status(409).json({ error: "Este nome já está em uso. Faça login com seu token." });
    return;
  }

  res.json({
    username: user.username,
    token: user.token,
  });
});

// Identify user by token (POST to keep token out of URL/logs)
app.post("/api/session", (req, res) => {
  const { token } = req.body as { token?: string };

  if (token && typeof token === "string") {
    const user = getUserByToken(token);
    if (user) {
      user.lastSeen = Date.now();
      res.json({ username: user.username, token: user.token });
      return;
    }
  }

  res.json({ username: null, token: null });
});

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
