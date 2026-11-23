import nodemailer from "nodemailer";
import type { Config } from "./config.js";

export interface Mail {
  an: string;
  betreff: string;
  text: string;
}

export interface MailVersand {
  sende(mail: Mail): Promise<void>;
}

export function erstelleMailVersand(config: Config, log: (msg: string) => void): MailVersand {
  if (!config.SMTP_URL) {
    return {
      async sende(mail) {
        log(`[Mail, nicht versendet: SMTP_URL fehlt] An: ${mail.an} | ${mail.betreff}\n${mail.text}`);
      },
    };
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  return {
    async sende(mail) {
      await transport.sendMail({ from: config.MAIL_ABSENDER, to: mail.an, subject: mail.betreff, text: mail.text });
    },
  };
}
