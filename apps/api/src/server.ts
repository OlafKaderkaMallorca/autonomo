import { baueApp } from "./app.js";
import { ladeConfig } from "./config.js";
import { verbindeDb } from "./db.js";
import { erstelleMailVersand } from "./mail.js";

const config = ladeConfig();
const sql = verbindeDb(config.DATABASE_URL);
const app = await baueApp({ sql, config, mail: erstelleMailVersand(config, (m) => app.log.info(m)), logger: true });

const beenden = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", beenden);
process.on("SIGINT", beenden);

await app.listen({ port: config.PORT, host: config.HOST });
