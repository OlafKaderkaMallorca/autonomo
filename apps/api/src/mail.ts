import nodemailer from "nodemailer";
import type { Config } from "./config.js";

export interface Anhang {
  dateiname: string;
  inhalt: Buffer;
  mime: string;
}

export interface Mail {
  an: string;
  betreff: string;
  text: string;
  /** Antworten gehen an den Betrieb statt an die Absenderadresse der Plattform. */
  antwortAn?: string | null;
  anhaenge?: Anhang[];
}

export interface MailVersand {
  sende(mail: Mail): Promise<void>;
}

export function erstelleMailVersand(config: Config, log: (msg: string) => void): MailVersand {
  if (!config.SMTP_URL) {
    return {
      async sende(mail) {
        const anhaenge = mail.anhaenge?.length ? `\nAnhänge: ${mail.anhaenge.map((a) => a.dateiname).join(", ")}` : "";
        log(`[Mail, nicht versendet: SMTP_URL fehlt] An: ${mail.an} | ${mail.betreff}\n${mail.text}${anhaenge}`);
      },
    };
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  return {
    async sende(mail) {
      await transport.sendMail({
        from: config.MAIL_ABSENDER,
        to: mail.an,
        replyTo: mail.antwortAn ?? undefined,
        subject: mail.betreff,
        text: mail.text,
        attachments: mail.anhaenge?.map((a) => ({ filename: a.dateiname, content: a.inhalt, contentType: a.mime })),
      });
    },
  };
}
