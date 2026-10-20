// Runs the simulator's WebAssembly engine off the page's main thread.
// Messages in: {id, args}. Messages out: {id, ok, stdout, stderr, trace}.
"use strict";
const BUST = self.location.search;
importScripts("replay-data/mayhem_sim.js" + BUST);

let ready = MayhemSim({
  locateFile: (path) => "replay-data/" + path + BUST,
  print: (s) => { out.push(s); },
  printErr: (s) => { err.push(s); },
});
let out = [], err = [];

// The PBE patch's data (--game-data data/pbe) isn't built in: it's fetched the first time it's
// needed, fresh, so a daily refresh of replay-data/pbe/ shows up without rebuilding the engine.
let pbe = null;
function loadPbe(sim) {
  if (!pbe) pbe = Promise.all(["champions", "items", "augments", "augment_pools"].map((n) =>
    fetch("replay-data/pbe/" + n + ".json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error("PBE data not found");
      return r.text();
    }).then((text) => ({ n, text })))).then((files) => {
      try { sim.FS.mkdir("/data/pbe"); } catch (x) { /* already there */ }
      for (const f of files) sim.FS.writeFile("/data/pbe/" + f.n + ".json", f.text);
    }).catch((x) => { pbe = null; throw x; });
  return pbe;
}

self.onmessage = async (e) => {
  const { id, args } = e.data;
  const sim = await ready;
  if (args.includes("--game-data")) {
    try { await loadPbe(sim); } catch (x) {
      self.postMessage({ id, ok: false, stdout: "", stderr: "error: couldn't load the PBE patch's data", trace: null });
      return;
    }
  }
  out = []; err = [];
  let ok = true, trace = null;
  try {
    try { sim.FS.unlink("/trace.json"); } catch (x) { /* none yet */ }
    const code = sim.callMain(args);
    ok = code === 0 || code === undefined;
    try { trace = sim.FS.readFile("/trace.json", { encoding: "utf8" }); } catch (x) { trace = null; }
  } catch (x) {
    ok = false;
    err.push(String(x && x.message ? x.message : x));
  }
  self.postMessage({ id, ok: ok && !err.some((l) => l.startsWith("error")), stdout: out.join("\n"), stderr: err.join("\n"), trace });
};
