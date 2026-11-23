import "server-only";
import { headers } from "next/headers";
import type { Sprache } from "@autonomo/shared";

const API_URL = process.env.API_URL ?? "http://localhost:4002";

export interface OeffentlichesAngebot {
  angebot: {
    nummer: string;
    titel: string;
    einleitung: string | null;
    gueltigBis: string;
    status: "gesendet" | "angenommen" | "abgelehnt";
    entschiedenAm: string | null;
    unterschriftName: string | null;
    positionen: {
      art: "pauschale" | "stunden" | "material";
      beschreibung: string;
      menge: number;
      einheit: string | null;
      preisCent: number;
      ivaSatz: number;
      stundenkontingent: number | null;
    }[];
    summen: { basisCent: number; ivaCent: number; ivaGruppen: { ivaSatz: number; basisCent: number; ivaCent: number }[] };
  };
  abgelaufen: boolean;
  kunde: { name: string };
  sprache: Sprache;
  betrieb: { name: string; email: string | null; telefon: string | null; farbe: string | null; hatLogo: boolean };
}

/** Leitet die IP des Kunden weiter, damit die API sie bei der Unterschrift festhält. */
async function weiterleitung(): Promise<Record<string, string>> {
  const h = await headers();
  const ip = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  return { ...(ip ? { "x-forwarded-for": ip } : {}), "user-agent": h.get("user-agent") ?? "" };
}

export async function oeffentlich(pfad: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  return fetch(`${API_URL}/oeffentlich${pfad}`, {
    method: init.method ?? "GET",
    headers: { ...(await weiterleitung()), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
}
