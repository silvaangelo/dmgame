import express from "express";
import path from "path";
import compression from "compression";
import { app, server } from "./server.js";
import { setupSocket } from "./socket.js";
import { startGameLoop } from "./game.js";
import { initDatabase, registerUser, getUserByToken, getUserByIp, trackUserIp } from "./database.js";

const PORT = Number(process.env.PORT) || 3000;

/* ================= MIDDLEWARE ================= */

app.use(compression());
app.use(express.json());

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

/* ================= API ROUTES ================= */

function getClientIp(req: express.Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0].trim();
  return req.ip || req.socket.remoteAddress || "";
}

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

  const ip = getClientIp(req);
  const user = registerUser(trimmed, ip);

  res.json({
    username: user.username,
    token: user.token,
  });
});

// Identify user by token
app.get("/api/session", (req, res) => {
  const token = req.query.token as string | undefined;
  const ip = getClientIp(req);

  // Try token first
  if (token) {
    const user = getUserByToken(token);
    if (user) {
      trackUserIp(token, ip);
      res.json({ username: user.username, token: user.token });
      return;
    }
  }

  // Try IP fingerprint
  const userByIp = getUserByIp(ip);
  if (userByIp) {
    trackUserIp(userByIp.token, ip);
    res.json({ username: userByIp.username, token: userByIp.token });
    return;
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
