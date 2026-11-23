import type { Mail, MailVersand } from "./mail.js";
import { HttpFehler } from "./fehler.js";

/** Mail verschicken; ein Fehler des Mailservers wird als verständliche Meldung zurückgegeben. */
export async function sendeOderFehler(mail: MailVersand, m: Mail): Promise<void> {
  try {
    await mail.sende(m);
  } catch (e) {
    throw new HttpFehler(
      502,
      "Die E-Mail konnte nicht verschickt werden. Bitte die Mail-Einstellungen (SMTP_URL) prüfen. Lokal muss das Test-Postfach laufen (pnpm db:start).",
      { grund: (e as Error).message },
      "mail_fehler",
    );
  }
}
