import { PNG } from 'pngjs';

function readImage(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('请选择有效的 PNG 蒙版。');
  if (bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000) throw new Error('图片尺寸过大，请缩小到 1600 万像素以内。');
  const image = PNG.sync.read(bytes);
  if (image.width * image.height > 16_000_000) throw new Error('图片尺寸过大，请缩小到 1600 万像素以内。');
  return image;
}

export function validateEditedMask(bytes, sourceBytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 64 * 1024 * 1024) throw new Error('蒙版文件过大或格式无效。');
  const image = readImage(sourceBytes), mask = readImage(bytes);
  if (mask.width !== image.width || mask.height !== image.height) throw new Error('修正蒙版与原图尺寸不一致。');
  for (let i = 0; i < mask.data.length; i += 4) {
    if (mask.data[i] !== mask.data[i + 1] || mask.data[i] !== mask.data[i + 2] || mask.data[i + 3] !== 255) throw new Error('请保存不透明的黑白前景蒙版，白色保留，黑色删除。');
    // A manual mask represents final opacity. Do not multiply existing soft alpha twice.
    const alpha = Math.min(mask.data[i], image.data[i + 3]);
    image.data[i + 3] = alpha <= 8 ? 0 : alpha;
  }
  const result = PNG.sync.write(image), summary = alphaSummary(result);
  if (!summary.hasTransparency || summary.foregroundRatio < 0.005) throw new Error('没有获得有效的前景蒙版。请保留人物主体，并擦除残留背景。');
  return result;
}

export function alphaSummary(bytes) {
  const image = readImage(bytes); let foreground = 0, transparent = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] > 8) foreground++;
    if (image.data[i] < 247) transparent++;
  }
  return { width: image.width, height: image.height, foregroundRatio: foreground / (image.width * image.height), transparentRatio: transparent / (image.width * image.height), hasTransparency: transparent > image.width * image.height * 0.005 && foreground > 0 };
}

export function applyForegroundMask(imageBytes, maskBytes) {
  const image = readImage(imageBytes), mask = readImage(maskBytes);
  if (image.width !== mask.width || image.height !== mask.height) throw new Error('抠图蒙版与原图尺寸不一致，已停止处理以免错删衣服。');
  const output = new PNG({ width: image.width, height: image.height });
  for (let i = 0; i < image.data.length; i += 4) {
    output.data[i] = image.data[i]; output.data[i + 1] = image.data[i + 1]; output.data[i + 2] = image.data[i + 2];
    // BiRefNet returns foreground=white. Clothing color never determines transparency.
    const alpha = Math.round(mask.data[i] * image.data[i + 3] / 255);
    output.data[i + 3] = alpha <= 8 ? 0 : alpha;
  }
  const bytes = PNG.sync.write(output);
  const summary = alphaSummary(bytes);
  if (!summary.hasTransparency || summary.foregroundRatio < 0.005) throw new Error('没有获得有效的前景蒙版。请检查人物是否完整入镜，或导入手动抠好的透明 PNG。');
  return bytes;
}

export function extractAlphaMask(bytes) {
  const image = readImage(bytes), output = new PNG({ width: image.width, height: image.height });
  for (let i = 0; i < image.data.length; i += 4) { const alpha = image.data[i + 3]; output.data.set([alpha, alpha, alpha, 255], i); }
  return PNG.sync.write(output);
}

export function prepareShapeImage(bytes) {
  const image = readImage(bytes);
  if (!alphaSummary(bytes).hasTransparency) throw new Error('请先自动抠图并检查透明轮廓，再生成 3D；不再按浅色颜色删除背景。');
  const { width, height, data } = image;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= 8) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < minX) throw new Error('抠图结果没有可用的主体。');
  const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;
  const side = Math.ceil(Math.max(cropWidth, cropHeight) * 1.16);
  const output = new PNG({ width: side, height: side }); output.data.fill(255);
  const offsetX = Math.floor((side - cropWidth) / 2), offsetY = Math.floor((side - cropHeight) / 2);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const src = (y * width + x) * 4, dst = ((y - minY + offsetY) * side + x - minX + offsetX) * 4;
    const alpha = data[src + 3] <= 8 ? 0 : data[src + 3] / 255;
    for (let c = 0; c < 3; c++) output.data[dst + c] = Math.round(data[src + c] * alpha + 255 * (1 - alpha));
  }
  return PNG.sync.write(output);
}
