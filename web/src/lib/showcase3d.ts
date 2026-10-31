// The 3D champion showcase's renderer (components/ChampionShowcase.tsx), loaded only when the
// showcase scrolls into view. Uses the same models as the Simulator replay (/assets/models/), at
// true in-game size: one model unit is 100 game units, times the skin's scale (models.json).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

type Entry = { file: string; scale?: number; clips: Record<string, string | null> };
const BASE = "/assets/models/";
let manifest: Promise<Record<string, Entry>> | null = null;
const models = () =>
  (manifest ??= fetch(BASE + "models.json")
    .then((r) => (r.ok ? r.json() : {}) as Promise<Record<string, Entry>>)
    .then((m): Record<string, Entry> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v])))
    .catch(() => ({}) as Record<string, Entry>));

// A frame this many game units tall fits an average champion with room to spare, so smaller and
// larger champions keep their real sizes; giants grow the frame to fit.
const FRAME = 220;

export function mount(canvas: HTMLCanvasElement, alias: string, opts: { animate: boolean }): Promise<() => void> {
  return models().then(async (m) => {
    const entry = m[alias.toLowerCase()];
    if (!entry) throw new Error("no model");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(BASE + entry.file);
    const root = gltf.scene;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        const ud = (mesh.material as THREE.Material).userData ?? {};
        if (ud.visible === false) mesh.visible = false;
      }
    });
    const units = 100 * (entry.scale ?? 1); // world unit = one game unit
    root.scale.setScalar(units);
    const mixer = new THREE.AnimationMixer(root);
    const idle = gltf.animations.find((a) => a.name === entry.clips.idle) ?? gltf.animations[0];
    if (idle) {
      const action = mixer.clipAction(idle);
      action.play();
      if (!opts.animate) mixer.setTime(0);
    }
    mixer.update(0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible) box.union(new THREE.Box3().setFromObject(o, true));
    });
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
    scene.add(root);

    const frame = Math.max(FRAME, size.y * 1.15, size.x * 0.9);
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    const dist = frame / 2 / Math.tan((30 * Math.PI) / 360);
    camera.position.set(0, frame * 0.45, dist);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, frame * 0.42, 0);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.3;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.autoRotate = opts.animate;
    controls.autoRotateSpeed = 1.2;
    controls.update();

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const clock = new THREE.Clock();
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      const dt = clock.getDelta();
      if (opts.animate) mixer.update(dt);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  });
}
