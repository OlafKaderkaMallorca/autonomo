import { oeffentlich } from "@/lib/oeffentlich";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await oeffentlich(`/angebote/${encodeURIComponent(token)}/logo`);
  if (!res.ok) return new Response(null, { status: 404 });
  return new Response(res.body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
}
