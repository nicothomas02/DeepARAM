// Picture-in-picture for the fight replay inside the Simulator embed: a "Pop out" button next to the
// replay controls copies the arena's layers (map, 3D models, effects) into one canvas each frame and
// plays that canvas as a video in a floating window, so the fight keeps playing while you scroll.

const LAYERS = ["arenaMap", "arena", "arena3d", "arenaOverlay"];

type PipVideo = HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
type PipDoc = Document & { pictureInPictureEnabled?: boolean; pictureInPictureElement?: Element | null; exitPictureInPicture?: () => Promise<void> };
type ReplayWindow = Window & { replayFrames?: number };

export function replayPip(doc: Document) {
  const d = doc as PipDoc;
  const win = doc.defaultView as ReplayWindow | null;
  const controls = doc.querySelector(".timeline .controls");
  const arena = doc.getElementById("arena") as HTMLCanvasElement | null;
  if (!win || !controls || !arena || doc.getElementById("pipBtn")) return;
  const probe = doc.createElement("video") as PipVideo;
  if (!d.pictureInPictureEnabled || !probe.requestPictureInPicture || !("captureStream" in arena)) return;

  const btn = doc.createElement("button");
  btn.id = "pipBtn";
  btn.type = "button";
  btn.textContent = "Pop out";
  btn.title = "Keep the replay playing in a small floating window";
  doc.getElementById("restart")?.after(btn);

  let video: PipVideo | null = null;
  let raf = 0;
  const stop = () => {
    win.cancelAnimationFrame(raf);
    video?.remove();
    video = null;
    btn.textContent = "Pop out";
    btn.setAttribute("aria-pressed", "false");
    if ("mediaSession" in win.navigator) for (const a of ["play", "pause"] as const) win.navigator.mediaSession.setActionHandler(a, null);
  };

  btn.addEventListener("click", async () => {
    if (video) {
      await d.exitPictureInPicture?.().catch(() => {});
      return;
    }
    const out = doc.createElement("canvas");
    out.width = arena.width;
    out.height = arena.height;
    const g = out.getContext("2d")!;
    // The 3D layer can only be copied in the same frame it was drawn, so this runs in the replay's
    // own frame loop (after its draw) and only when the replay drew a new frame.
    let seen = -1;
    const copy = () => {
      const n = win.replayFrames ?? 0;
      if (n !== seen) {
        seen = n;
        g.clearRect(0, 0, out.width, out.height);
        for (const id of LAYERS) {
          const c = doc.getElementById(id) as HTMLCanvasElement | null;
          if (c && c.width && c.height) g.drawImage(c, 0, 0, out.width, out.height);
        }
      }
      raf = win.requestAnimationFrame(copy);
    };
    copy();
    const v = doc.createElement("video") as PipVideo;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none";
    v.srcObject = out.captureStream(30);
    doc.body.append(v);
    video = v;
    v.addEventListener("leavepictureinpicture", stop, { once: true });
    try {
      await v.play();
      await v.requestPictureInPicture!();
      btn.textContent = "Pop back in";
      btn.setAttribute("aria-pressed", "true");
      // The floating window's play and pause buttons drive the replay, not the copied video.
      if ("mediaSession" in win.navigator) {
        const toggle = () => (doc.getElementById("play") as HTMLButtonElement | null)?.click();
        win.navigator.mediaSession.setActionHandler("play", toggle);
        win.navigator.mediaSession.setActionHandler("pause", toggle);
      }
    } catch {
      stop();
    }
  });
}
