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
      return reply.code(err.statusCode).send({ fehler: err.message, details: err.details });
    }
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
  await app.register(async (a) => kundenRoutes(a, deps));
  return app;
}
