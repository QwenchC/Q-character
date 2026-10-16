import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { RotateCcw, Scan, Box, Grid2X2, Camera } from 'lucide-react';
import { textureModel, recolorPbrModel } from './texturing';
import type { Swatch } from './color';
import type { Projection } from './texture-image';

export interface ViewerHandle { exportModel(format: 'glb' | 'stl', heightMm: number): Promise<Uint8Array>; referenceSheet(heightMm: number, name: string): Promise<Uint8Array>; texture(reference: string, swatches: Swatch[], projection: Projection, originalPbrUrl?: string): Promise<Uint8Array> }
interface Props { url?: string; filename?: string; onLoaded?: (info: { faces: number; meshes: number }) => void }

function assetManager() {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(resource => {
    if (/^(data:|blob:|qasset:)/.test(resource) || (window.QNative && resource.startsWith('https://appassets.androidplatform.net/projects/'))) return resource;
    throw new Error('模型引用了外部资源。请导出为包含贴图的 GLB。');
  });
  return manager;
}

function sampleCharacter() {
  const group = new THREE.Group();
  const materials = { skin: new THREE.MeshStandardMaterial({ color: '#f4d3b6', roughness: 0.95 }), dress: new THREE.MeshStandardMaterial({ color: '#a9bdaa', roughness: 0.95 }), hair: new THREE.MeshStandardMaterial({ color: '#50453f', roughness: 0.95 }), dark: new THREE.MeshStandardMaterial({ color: '#3b3632' }) };
  const sphere = (size: number[], position: number[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 32), mat); mesh.scale.set(...size as [number, number, number]); mesh.position.set(...position as [number, number, number]); group.add(mesh); return mesh;
  };
  sphere([0.68, 0.63, 0.6], [0, 1.98, 0], materials.skin);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.52), materials.hair); cap.scale.set(0.705, 0.68, 0.63); cap.position.y = 2; group.add(cap);
  sphere([0.55, 0.28, 0.18], [0, 2.33, 0.48], materials.hair);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.47, 0.84, 40), materials.dress); body.position.y = 1.04; group.add(body);
  sphere([0.15, 0.4, 0.17], [-0.43, 1.08, 0], materials.skin).rotation.z = -0.22;
  sphere([0.15, 0.4, 0.17], [0.43, 1.08, 0], materials.skin).rotation.z = 0.22;
  for (const x of [-0.22, 0.22]) { sphere([0.17, 0.27, 0.18], [x, 0.43, 0], materials.skin); sphere([0.21, 0.14, 0.29], [x, 0.18, 0.12], materials.hair); sphere([0.048, 0.068, 0.032], [x * 1.1, 2, 0.565], materials.dark); }
  return group;
}

function disposeObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>(); const geometries = new Set<THREE.BufferGeometry>();
  object.traverse(item => { if (item instanceof THREE.Mesh) { geometries.add(item.geometry); for (const mat of Array.isArray(item.material) ? item.material : [item.material]) { materials.add(mat); for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value); } } });
  geometries.forEach(x => x.dispose()); materials.forEach(x => x.dispose()); textures.forEach(x => x.dispose());
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer({ url, filename, onLoaded }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; controls: OrbitControls; model: THREE.Group; source: THREE.Object3D; grid: THREE.GridHelper; originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>; clay: THREE.MeshStandardMaterial } | null>(null);
  const [error, setError] = useState(''); const [clay, setClay] = useState(false); const [grid, setGrid] = useState(true);
  const [loading, setLoading] = useState(false); const loaded = useRef(onLoaded); loaded.current = onLoaded;

  const view = (direction: 'front' | 'side' | 'back' | 'perspective') => {
    const state = runtime.current; if (!state) return;
    const p = direction === 'front' ? [0, 1.5, 7] : direction === 'side' ? [7, 1.5, 0] : direction === 'back' ? [0, 1.5, -7] : [5, 3.5, 7];
    state.camera.position.set(...p as [number, number, number]); state.camera.zoom = 1; state.controls.target.set(0, 1.5, 0); state.controls.update(); state.camera.updateProjectionMatrix();
  };

  useImperativeHandle(ref, () => ({
    async texture(reference, swatches, projection, originalPbrUrl) {
      const state = runtime.current; if (!state || !url || loading || error) throw new Error('请先等待模型加载完成。');
      if (originalPbrUrl) {
        const source = (await new GLTFLoader(assetManager()).loadAsync(originalPbrUrl)).scene;
        try { return await recolorPbrModel(source, swatches); } finally { disposeObject(source); }
      }
      return textureModel(state.source, reference, swatches, projection);
    },
    async exportModel(format, heightMm) {
      const state = runtime.current; if (!state || !url) throw new Error('请先加载真实模型。');
      const root = new THREE.Group(); const object = state.source.clone(true); root.add(object);
      // Display-only clay materials must not replace the asset's original materials on export.
      const originalMeshes: THREE.Mesh[] = []; const clonedMeshes: THREE.Mesh[] = [];
      state.source.traverse(x => { if (x instanceof THREE.Mesh) originalMeshes.push(x); });
      object.traverse(x => { if (x instanceof THREE.Mesh) clonedMeshes.push(x); });
      clonedMeshes.forEach((mesh, i) => { mesh.material = state.originals.get(originalMeshes[i]) ?? originalMeshes[i].material; });
      const box = new THREE.Box3().setFromObject(object); const size = box.getSize(new THREE.Vector3());
      if (size.y <= 0) throw new Error('模型没有有效高度。');
      const scale = (format === 'glb' ? heightMm / 1000 : heightMm) / size.y;
      const center = box.getCenter(new THREE.Vector3());
      root.scale.setScalar(scale); object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); root.updateMatrixWorld(true);
      if (format === 'stl') { const result = new STLExporter().parse(root, { binary: true }); return new Uint8Array(result.buffer, result.byteOffset, result.byteLength); }
      const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false });
      if (!(result instanceof ArrayBuffer)) throw new Error('GLB 导出失败。');
      return new Uint8Array(result);
    },
    async referenceSheet(heightMm, name) {
      const state = runtime.current; if (!state || !url) throw new Error('请先加载真实模型。');
      const canvas = document.createElement('canvas'); canvas.width = 2100; canvas.height = 1140;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f7f6f2'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#35463b'; ctx.font = 'bold 36px "Microsoft YaHei", sans-serif'; ctx.fillText(`${name} · 黏土制作参考`, 70, 70);
      ctx.fillStyle = '#777e76'; ctx.font = '22px "Microsoft YaHei", sans-serif'; ctx.fillText(`目标高度 ${heightMm} mm · 正交视图 · 来自同一个 3D 模型 · 图片不具有打印实物比例`, 70, 110);
      const camera = new THREE.OrthographicCamera(-1.3, 1.3, 1.95, -1.95, 0.01, 100);
      const temp = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); temp.setPixelRatio(1); temp.setSize(620, 930); temp.setClearColor('#f7f6f2'); temp.outputColorSpace = THREE.SRGBColorSpace;
      const oldGrid = state.grid.visible; state.grid.visible = false;
      try {
        const positions = [[0, 1.5, 7], [7, 1.5, 0], [0, 1.5, -7]];
        for (let i = 0; i < positions.length; i++) {
          camera.position.set(...positions[i] as [number, number, number]); camera.lookAt(0, 1.5, 0); camera.updateProjectionMatrix(); temp.render(state.scene, camera);
          const x = 45 + i * 695; ctx.drawImage(temp.domElement, x, 150, 620, 930);
          ctx.fillStyle = '#35463b'; ctx.font = '26px "Microsoft YaHei", sans-serif'; ctx.fillText(['正面 FRONT', '侧面 SIDE', '背面 BACK'][i], x + 215, 1100);
          const top = 150 + 0.45 / 3.9 * 930; const bottom = top + 3 / 3.9 * 930;
          ctx.strokeStyle = '#84998b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 610, top); ctx.lineTo(x + 610, bottom); ctx.stroke();
          ctx.font = '19px sans-serif'; ctx.fillText(`${heightMm} mm`, x + 530, 140);
        }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('参考图生成失败。')), 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
      } finally { state.grid.visible = oldGrid; temp.dispose(); temp.forceContextLoss(); }
    },
  }), [url, loading, error]);

  useEffect(() => {
    if (!host.current) return;
    const element = host.current; let stopped = false; let frame = 0; let state: NonNullable<typeof runtime.current> | undefined;
    setError(''); setLoading(!!url); setClay(false); setGrid(true);
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, window.QNative ? 1.5 : 2)); renderer.setClearColor('#eeefea'); renderer.outputColorSpace = THREE.SRGBColorSpace; element.appendChild(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#eeefea');
      const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100); camera.position.set(5, 3.5, 7);
      const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.5, 0); controls.enableDamping = true; controls.minZoom = 0.3; controls.maxZoom = 4; controls.update();
      scene.add(new THREE.HemisphereLight('#ffffff', '#9b9f91', 2.5));
      const key = new THREE.DirectionalLight('#fff8eb', 3.5); key.position.set(4, 7, 5); scene.add(key);
      const fill = new THREE.DirectionalLight('#e2edff', 1.5); fill.position.set(-4, 3, -4); scene.add(fill);
      const gridObject = new THREE.GridHelper(10, 20, '#c0c8bb', '#dde1d8'); scene.add(gridObject);
      const model = new THREE.Group(); scene.add(model);
      state = { renderer, scene, camera, controls, model, source: new THREE.Group(), grid: gridObject, originals: new Map(), clay: new THREE.MeshStandardMaterial({ color: '#d7c6ae', roughness: 0.98 }) }; runtime.current = state;
      const resize = () => { const width = element.clientWidth; const height = element.clientHeight; if (!width || !height) return; renderer.setSize(width, height); const aspect = width / height; camera.left = -2.12 * aspect; camera.right = 2.12 * aspect; camera.top = 2.12; camera.bottom = -2.12; camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(element); resize();
      const animate = () => { if (stopped) return; controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
      const load = async () => {
        let object: THREE.Object3D;
        if (!url) object = sampleCharacter();
        else if (/\.stl$/i.test(filename || '')) { const geometry = await new STLLoader().loadAsync(url); geometry.computeVertexNormals(); object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#d1bfa6', roughness: 0.9 })); }
        else if (/\.obj$/i.test(filename || '')) object = await new OBJLoader().loadAsync(url);
        else {
          object = (await new GLTFLoader(assetManager()).loadAsync(url)).scene;
        }
        if (stopped) { disposeObject(object); return; }
        object.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(object); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) { disposeObject(object); throw new Error('模型没有可显示的几何体。'); }
        model.scale.setScalar(3 / size.y); object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); model.add(object); state!.source = object;
        let faces = 0; let meshes = 0;
        object.traverse(child => { if (child instanceof THREE.Mesh) { meshes++; faces += (child.geometry.index?.count ?? child.geometry.attributes.position?.count ?? 0) / 3; state!.originals.set(child, child.material); } });
        loaded.current?.({ faces: Math.round(faces), meshes }); setLoading(false);
      };
      load().catch(e => { if (!stopped) { setError(e.message); setLoading(false); } });
      return () => { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); disposeObject(model); gridObject.geometry.dispose(); (gridObject.material as THREE.Material).dispose(); state?.clay.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); runtime.current = null; };
    } catch (e) { setError((e as Error).message); setLoading(false); }
  }, [url, filename]);

  useEffect(() => { const state = runtime.current; if (!state) return; state.grid.visible = grid; state.originals.forEach((material, mesh) => { mesh.material = clay ? state.clay : material; }); }, [clay, grid]);

  return <div className="viewer-shell"><div className="viewer-canvas" ref={host}/>
    <div className="viewer-tag"><span className="live-dot"/>{url ? '实时 3D 预览' : '比例示意 · 非 AI 生成'}</div>
    {loading && <div className="viewer-overlay">正在加载模型…</div>}{error && <div className="viewer-overlay error">模型加载失败：{error}</div>}
    <div className="viewer-tools"><button onClick={() => view('perspective')} title="重置视角"><RotateCcw size={16}/></button><button className={clay ? 'selected' : ''} onClick={() => setClay(!clay)} title="素色泥模"><Box size={16}/></button><button className={grid ? 'selected' : ''} onClick={() => setGrid(!grid)} title="地面网格"><Grid2X2 size={16}/></button></div>
    <div className="view-presets"><button onClick={() => view('front')}><Scan size={14}/>正面</button><button onClick={() => view('side')}>侧面</button><button onClick={() => view('back')}>背面</button><button onClick={() => view('perspective')}><Camera size={14}/>自由视角</button></div>
    <div className="viewer-hint">{window.QNative ? '单指旋转 · 双指缩放与平移' : '拖动旋转 · 滚轮缩放 · 右键平移'}</div>
  </div>;
});
