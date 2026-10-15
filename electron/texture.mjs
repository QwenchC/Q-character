export function validateTexturedGlb(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 28 || bytes.length > 256 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('请选择有效的 GLB 2.0 文件。');
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  if (jsonLength > 8 * 1024 * 1024 || bytes.readUInt32LE(16) !== 0x4e4f534a || binHeader + 8 > bytes.length) throw new Error('GLB 内容不完整。');
  let gltf; try { gltf = JSON.parse(bytes.toString('utf8', 20, binHeader)); } catch { throw new Error('GLB 内容无效。'); }
  const binLength = bytes.readUInt32LE(binHeader);
  if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942 || binHeader + 8 + binLength !== bytes.length || gltf.buffers?.length !== 1 || gltf.buffers[0].uri || gltf.buffers[0].byteLength > binLength) throw new Error('请将网格和贴图完整内嵌到 GLB 中。');
  for (const view of gltf.bufferViews || []) if (view.buffer !== 0 || !Number.isInteger(view.byteLength) || view.byteLength < 0 || (view.byteOffset || 0) < 0 || (view.byteOffset || 0) + view.byteLength > binLength) throw new Error('GLB 数据范围无效。');
  for (const image of gltf.images || []) {
    const view = gltf.bufferViews?.[image.bufferView];
    if (image.uri || !view || !['image/png', 'image/jpeg'].includes(image.mimeType)) throw new Error('GLB 贴图必须内嵌，不能引用外部文件。');
    const start = binHeader + 8 + (view.byteOffset || 0);
    if (image.mimeType === 'image/png' && bytes.subarray(start, start + 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('GLB 内嵌贴图无效。');
  }
  const primitives = (gltf.meshes || []).flatMap(mesh => mesh.primitives || []);
  if (!primitives.length || primitives.some(p => !gltf.accessors?.[p.attributes?.POSITION] || !gltf.accessors?.[p.attributes?.TEXCOORD_0] || !gltf.images?.[gltf.textures?.[gltf.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture?.index]?.source])) throw new Error('模型需要 UV 坐标和有效的颜色贴图。');
  return { meshes: gltf.meshes.length, textures: gltf.images.length };
}

const hex = value => { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('颜色值无效。'); return value.toLowerCase(); };
export function normalizeClayGuide(value) {
  if (!value || !Array.isArray(value.swatches) || value.swatches.length < 1 || value.swatches.length > 12 || !Array.isArray(value.bases) || value.bases.length !== 6) throw new Error('调色指引数据无效。');
  return { referenceId: String(value.referenceId), swatches: value.swatches.map((s, i) => ({ id: `color-${i}`, name: String(s.name || '角色颜色').slice(0, 30), original: hex(s.original), target: hex(s.target), share: Math.min(1, Math.max(0, Number(s.share) || 0)) })), bases: value.bases.map(b => ({ name: String(b.name || '基础黏土').slice(0, 20), hex: hex(b.hex) })) };
}
export function normalizeTextureConfig(value) {
  const swatches = normalizeClayGuide({ ...value, bases: Array.from({ length: 6 }, () => ({ name: '', hex: '#ffffff' })) }).swatches;
  const p = value.projection;
  if (!p || ![0, 90, 180, 270].includes(p.turn) || ![p.scale, p.offsetX, p.offsetY].every(Number.isFinite) || p.scale < 0.75 || p.scale > 1.25 || Math.abs(p.offsetX) > 0.2 || Math.abs(p.offsetY) > 0.2) throw new Error('贴图对齐参数无效。');
  const headFraction = p.headFraction ?? 0.34;
  if (!Number.isFinite(headFraction) || headFraction < 0.2 || headFraction > 0.5) throw new Error('背面头部范围无效。');
  return { swatches, projection: { turn: p.turn, scale: p.scale, offsetX: p.offsetX, offsetY: p.offsetY, headFraction } };
}
