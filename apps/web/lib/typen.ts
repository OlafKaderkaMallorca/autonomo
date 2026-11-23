import type { Rolle, Sprache } from "@autonomo/shared";

export interface Ich {
  id: string;
  email: string;
  name: string;
  sprache: Sprache;
  plattformAdmin: boolean;
  betriebe: { id: string; name: string; rolle: Rolle; kundeId: string | null }[];
}

export interface Kunde {
  id: string;
  typ: "privat" | "firma";
  name: string;
  steuernummer: string | null;
  email: string | null;
  sprache: Sprache;
}
