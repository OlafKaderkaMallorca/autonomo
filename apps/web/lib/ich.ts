import "server-only";
import { redirect } from "next/navigation";
import { api, ApiFehler } from "./api";
import type { Ich } from "./typen";

/** Lädt den angemeldeten Benutzer oder leitet zur Anmeldung weiter. */
export async function ichOderLogin(): Promise<Ich> {
  try {
    return await api<Ich>("/me");
  } catch (e) {
    if (e instanceof ApiFehler && e.status === 401) redirect("/login");
    throw e;
  }
}
