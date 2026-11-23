"use server";

import { revalidatePath } from "next/cache";
import { oeffentlich } from "@/lib/oeffentlich";

export interface EntscheidungsZustand {
  fehler?: "fehlt" | "abgelaufen" | "entschieden" | "allgemein";
}

function fehlerAus(status: number): EntscheidungsZustand["fehler"] {
  if (status === 400) return "fehlt";
  if (status === 410) return "abgelaufen";
  if (status === 409) return "entschieden";
  return "allgemein";
}

export async function annehmen(token: string, _vorher: EntscheidungsZustand, daten: FormData): Promise<EntscheidungsZustand> {
  const name = String(daten.get("name") ?? "").trim();
  const unterschrift = String(daten.get("unterschrift") ?? "");
  if (name.length < 2 || !unterschrift) return { fehler: "fehlt" };
  const res = await oeffentlich(`/angebote/${encodeURIComponent(token)}/annehmen`, { method: "POST", body: { name, unterschrift } });
  if (!res.ok) return { fehler: fehlerAus(res.status) };
  revalidatePath(`/angebot/${token}`);
  return {};
}

export async function ablehnen(token: string, _vorher: EntscheidungsZustand, daten: FormData): Promise<EntscheidungsZustand> {
  const grund = String(daten.get("grund") ?? "").trim();
  const res = await oeffentlich(`/angebote/${encodeURIComponent(token)}/ablehnen`, { method: "POST", body: grund ? { grund } : {} });
  if (!res.ok) return { fehler: fehlerAus(res.status) };
  revalidatePath(`/angebot/${token}`);
  return {};
}
