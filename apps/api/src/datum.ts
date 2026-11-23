/** Heutiges Datum in Spanien (Europe/Madrid) als „YYYY-MM-DD“. */
export function heuteMadrid(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
}
