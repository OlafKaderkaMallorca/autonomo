import { apiRoh } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ betriebId: string }> }) {
  const { betriebId } = await params;
  const res = await apiRoh(`/betriebe/${betriebId}/logo`);
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, { headers: { "content-type": "image/png", "cache-control": "private, max-age=300" } });
}
