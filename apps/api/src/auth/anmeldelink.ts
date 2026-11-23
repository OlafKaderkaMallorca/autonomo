import { t, type Sprache } from "@autonomo/shared";
import type { Config } from "../config.js";
import type { Sql, Tx } from "../db.js";
import type { MailVersand } from "../mail.js";
import { neuesToken } from "./tokens.js";

export interface BenutzerFuerMail {
  id: string;
  email: string;
  sprache: Sprache;
}

/** Erzeugt einen einmaligen Anmeldelink und verschickt ihn per E-Mail. */
export async function sendeAnmeldelink(
  db: Sql | Tx,
  config: Config,
  mail: MailVersand,
  benutzer: BenutzerFuerMail,
): Promise<void> {
  const { token, hash } = neuesToken();
  await db`insert into login_token (benutzer_id, token_hash, laeuft_ab_am)
    values (${benutzer.id}, ${hash}, now() + make_interval(mins => ${config.MAGIC_LINK_MINUTEN}))`;
  const link = `${config.WEB_URL}/login/link?token=${encodeURIComponent(token)}`;
  await mail.sende({
    an: benutzer.email,
    betreff: t(benutzer.sprache, "mail.magicLink.betreff"),
    text: t(benutzer.sprache, "mail.magicLink.text", { link, minuten: config.MAGIC_LINK_MINUTEN }),
  });
}
