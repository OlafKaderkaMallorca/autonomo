import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { erstelleAuth, type Auth } from "./auth/plugin.js";
import type { Config } from "./config.js";
import type { Sql } from "./db.js";
import { HttpFehler } from "./fehler.js";
import type { MailVersand } from "./mail.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { betriebRoutes } from "./routes/betriebe.js";
import { kundenRoutes } from "./routes/kunden.js";
import { angeboteRoutes } from "./routes/angebote.js";
import { aufgabenRoutes } from "./routes/aufgaben.js";
import { auftraegeRoutes } from "./routes/auftraege.js";
import { einstellungenRoutes } from "./routes/einstellungen.js";
import { rechnungenRoutes } from "./routes/rechnungen.js";
import { uebersichtRoutes } from "./routes/uebersicht.js";
import { zeitRoutes } from "./routes/zeit.js";

export interface Deps {
  sql: Sql;
  config: Config;
  mail: MailVersand;
  auth: Auth;
}

export async function baueApp(opts: { sql: Sql; config: Config; mail: MailVersand; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpFehler) {
      return reply.code(err.statusCode).send({ fehler: err.message, code: err.code, details: err.details });
    }
    // Von Datenbank-Triggern ausgelöste Schutzregeln (z. B. ausgestellte Rechnung ändern)
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "P0001") {
      return reply.code(409).send({ fehler: (err as Error).message, code: "gesperrt" });
    }
    if (pgCode === "22P02") return reply.code(404).send({ fehler: "Nicht gefunden", code: "nicht_gefunden" });
    if (pgCode === "23503") return reply.code(400).send({ fehler: "Verweis auf einen nicht vorhandenen Datensatz", code: "verweis_ungueltig" });
    if (pgCode === "23505") return reply.code(409).send({ fehler: "Eintrag existiert bereits", code: "doppelt" });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ fehler: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ fehler: "Interner Fehler" });
  });

  const deps: Deps = { ...opts, auth: erstelleAuth(opts.sql) };

  app.get("/health", async () => {
    await opts.sql`select 1`;
    return { ok: true };
  });

  await app.register(async (a) => authRoutes(a, deps));
  await app.register(async (a) => adminRoutes(a, deps));
  await app.register(async (a) => betriebRoutes(a, deps));
  for (const routes of [
    kundenRoutes,
    einstellungenRoutes,
    angeboteRoutes,
    auftraegeRoutes,
    aufgabenRoutes,
    zeitRoutes,
    rechnungenRoutes,
    uebersichtRoutes,
  ]) {
    await app.register(async (a) => routes(a, deps));
  }
  return app;
}
