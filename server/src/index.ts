import path from "path";
import fs from "fs";
import express from "express";
import { config } from "./config";
import { log } from "./logger";
import { api } from "./api";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "14mb" })); // референс в base64

// ---------- health check для Render ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ts: Date.now() });
});

// ---------- API ----------
app.use("/api", api);

// ---------- статика фронтенда ----------
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA-fallback: всё не-/api → index.html
  app.get(/^(?!\/api\/|\/health).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  log.warn(`client/dist не найден (${clientDist}) — раздаётся только API`);
}

// ---------- обработчик ошибок ----------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("unhandled", err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

app.listen(config.port, () => {
  log.info(`UniGen запущен: http://localhost:${config.port} (${config.nodeEnv})`);
  log.info(`DATA_DIR=${config.dataDir}, concurrency=${config.concurrency}`);
});
