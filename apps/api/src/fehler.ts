import type { ZodType, ZodTypeDef } from "zod";

export class HttpFehler extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function validiere<T>(schema: ZodType<T, ZodTypeDef, unknown>, daten: unknown): T {
  const ergebnis = schema.safeParse(daten);
  if (!ergebnis.success) {
    throw new HttpFehler(400, "Ungültige Eingabe", ergebnis.error.flatten());
  }
  return ergebnis.data;
}
