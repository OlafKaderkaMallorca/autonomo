import { oeffentlich } from "@/lib/oeffentlich";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await oeffentlich(`/angebote/${encodeURIComponent(token)}/pdf`);
  if (!res.ok) return new Response("Nicht gefunden", { status: 404 });
  return new Response(res.body, {
    headers: { "content-type": "application/pdf", "content-disposition": res.headers.get("content-disposition") ?? "inline" },
  });
}
