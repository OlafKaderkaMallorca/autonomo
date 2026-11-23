import { apiRoh } from "@/lib/api";

export async function GET(req: Request, { params }: { params: Promise<{ betriebId: string; id: string }> }) {
  const { betriebId, id } = await params;
  const groesse = new URL(req.url).searchParams.get("groesse") === "klein" ? "klein" : "gross";
  const res = await apiRoh(`/betriebe/${betriebId}/fotos/${encodeURIComponent(id)}/bild?groesse=${groesse}`);
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}
