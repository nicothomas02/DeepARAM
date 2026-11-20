import { APP_DOWNLOADS, isAppOs } from "@/lib/app-downloads";

// GET /download/windows, /download/mac: streams the newest release's installer from deeparam.com itself, so the
// download never points visitors anywhere else. Before the first release, it sends them back to /download.
const RELEASES = "https://github.com/nicothomas02/DeepARAM/releases/latest/download/";

export async function GET(req: Request, { params }: { params: Promise<{ os: string }> }) {
  const { os } = await params;
  if (!isAppOs(os)) return new Response("Not found", { status: 404 });
  const { file, type } = APP_DOWNLOADS[os];
  let res: Response | null = null;
  try {
    res = await fetch(RELEASES + file, { redirect: "follow", cache: "no-store" });
  } catch {
    res = null;
  }
  if (!res?.ok || !res.body) {
    return Response.redirect(new URL(`/download?soon=${os}`, req.url), 302);
  }
  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "public, max-age=600",
    "X-Content-Type-Options": "nosniff",
  });
  const size = res.headers.get("content-length");
  if (size) headers.set("Content-Length", size);
  return new Response(res.body, { headers });
}
