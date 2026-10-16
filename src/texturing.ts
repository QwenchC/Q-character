import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildTextureAtlas, recolorPixels, type Projection } from './texture-image';
import type { Swatch } from './color';

export async function recolorPbrModel(source: THREE.Object3D, swatches: Swatch[]) {
  const root = source.clone(true), materials: THREE.Material[] = [], textures = new Map<THREE.Texture, THREE.Texture>();
  let meshes = 0;
  try {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) throw new Error('请先将模型转换为静态网格。');
      meshes++;
      const recolor = (original: THREE.Material) => {
        if (!(original instanceof THREE.MeshStandardMaterial) || !original.map || !object.geometry.getAttribute('uv')) throw new Error('该模型没有完整的 PBR 颜色贴图与 UV。');
        const material = original.clone(); materials.push(material);
        let texture = textures.get(original.map);
        if (!texture) {
          const image = original.map.image as CanvasImageSource & { width: number; height: number };
          if (!image || image.width * image.height > 4096 * 4096) throw new Error('颜色贴图过大或尚未载入。');
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height); recolorPixels(pixels.data, swatches); context.putImageData(pixels, 0, 0);
          texture = original.map.clone(); texture.image = canvas; texture.needsUpdate = true; textures.set(original.map, texture);
        }
        material.map = texture;
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(recolor) : recolor(object.material);
    });
    if (!meshes) throw new Error('模型没有可换色的网格。');
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false });
    if (!(result instanceof ArrayBuffer)) throw new Error('AI 贴图换色失败。');
    return new Uint8Array(result);
  } finally { materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); }
}

export async function readReference(url: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('无法读取上色参考图。')); img.src = url; });
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  if (canvas.width * canvas.height > 16_000_000) throw new Error('参考图过大，请缩小后重试。');
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function textureModel(source: THREE.Object3D, reference: string, swatches: Swatch[], projection: Projection) {
  const image = await readReference(reference), atlas = buildTextureAtlas(image.data, image.width, image.height, swatches, 1024, projection.headFraction);
  const canvas = document.createElement('canvas'); canvas.width = atlas.width; canvas.height = atlas.height;
  canvas.getContext('2d')!.putImageData(new ImageData(atlas.pixels, atlas.width, atlas.height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  material.name = '设计图颜色 · 正面投影与侧背色块';
  const root = new THREE.Group(), meshes: { geometry: THREE.BufferGeometry; projected: Float32Array }[] = [];
  const rotation = new THREE.Matrix4().makeRotationY(projection.turn * Math.PI / 180), box = new THREE.Box3(), point = new THREE.Vector3();
  source.updateWorldMatrix(true, true); const inverse = source.matrixWorld.clone().invert();
  try {
    source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) throw new Error('请先将模型转换为静态网格，再进行设计图上色。');
      let geometry = object.geometry.clone();
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      geometry.clearGroups(); geometry.deleteAttribute('color'); geometry.morphAttributes = {};
      const positions = geometry.getAttribute('position'), projected = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i).applyMatrix4(rotation); point.toArray(projected, i * 3); box.expandByPoint(point); }
      const mesh = new THREE.Mesh(geometry, material); root.add(mesh); meshes.push({ geometry, projected });
    });
    if (!meshes.length) throw new Error('模型没有可上色的网格。');
    const size = box.getSize(new THREE.Vector3()); if (size.x <= 0 || size.y <= 0) throw new Error('模型尺寸无效。');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
    const inset = 2 / atlas.width;
    for (const { geometry, projected } of meshes) {
      const uv = new Float32Array(projected.length / 3 * 2);
      for (let i = 0; i < projected.length / 3; i += 3) {
        a.fromArray(projected, i * 3); b.fromArray(projected, (i + 1) * 3); c.fromArray(projected, (i + 2) * 3);
        normal.crossVectors(b.sub(a), c.sub(a)).normalize(); const front = normal.z > 0.12;
        for (let j = i; j < i + 3; j++) {
          const x = ((projected[j * 3] - box.min.x) / size.x - 0.5) / projection.scale + 0.5 + projection.offsetX;
          const y = (projected[j * 3 + 1] - box.min.y) / size.y / projection.scale + (1 - 1 / projection.scale) / 2 + projection.offsetY;
          uv[j * 2] = (front ? 0 : 0.5) + inset + THREE.MathUtils.clamp(x, 0, 1) * (0.5 - inset * 2);
          uv[j * 2 + 1] = 1 / atlas.height + THREE.MathUtils.clamp(y, 0, 1) * (1 - 2 / atlas.height);
        }
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    root.userData = { textureMethod: 'reference-projection', backDetail: 'estimated-color-blocks' };
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false });
    if (!(result instanceof ArrayBuffer)) throw new Error('带贴图模型生成失败。');
    return new Uint8Array(result);
  } finally { meshes.forEach(({ geometry }) => geometry.dispose()); material.dispose(); texture.dispose(); }
}
