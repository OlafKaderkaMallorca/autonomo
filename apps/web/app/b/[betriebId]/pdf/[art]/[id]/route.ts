import { apiRoh } from "@/lib/api";

/** Reicht PDFs von Angeboten und Rechnungen aus der API durch (mit der Sitzung des Benutzers). */
export async function GET(_req: Request, { params }: { params: Promise<{ betriebId: string; art: string; id: string }> }) {
  const { betriebId, art, id } = await params;
  if (art !== "angebote" && art !== "rechnungen") return new Response(null, { status: 404 });
  const res = await apiRoh(`/betriebe/${betriebId}/${art}/${encodeURIComponent(id)}/pdf`);
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: { "content-type": "application/pdf", "content-disposition": res.headers.get("content-disposition") ?? "inline" },
  });
}
