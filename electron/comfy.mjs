import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { collectOutputs } from './workflows.mjs';

export function inputOptions(info, node, name) {
  const spec = info[node]?.input?.required?.[name] ?? info[node]?.input?.optional?.[name];
  return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options ?? [];
}

export function normalizeServer(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请输入 ComfyUI 的 HTTP(S) 根地址，例如 http://127.0.0.1:8188');
  return url.origin;
}

export class ComfyClient {
  constructor(baseUrl) { this.base = normalizeServer(baseUrl); this.clientId = randomUUID(); }
  async request(route, options = {}, timeoutMs = 12000) {
    let response;
    try { response = await fetch(`${this.base}${route}`, { ...options, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) { throw new Error(`无法连接 ComfyUI（${this.base}）。请在绘世启动器中启动服务并核对端口。${error.name === 'TimeoutError' ? ' 请求超时。' : ''}`); }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2000);
      throw new Error(`ComfyUI 返回 ${response.status}：${body}`);
    }
    return response;
  }
  async json(route, body) {
    const response = await this.request(route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response.json();
  }
  async capabilities() {
    const [stats, info] = await Promise.all([this.json('/system_stats'), this.json('/object_info')]);
    if (!stats.system || !Array.isArray(stats.devices) || !info.KSampler?.input) throw new Error('该地址没有返回有效的 ComfyUI 服务信息。');
    const checkpoints = inputOptions(info, 'CheckpointLoaderSimple', 'ckpt_name');
    const shapeCheckpoints = inputOptions(info, 'ImageOnlyCheckpointLoader', 'ckpt_name').filter(name => /hunyuan.*3d|hunyuan_3d/i.test(name));
    const qwenModels = inputOptions(info, 'UNETLoader', 'unet_name').filter(name => /^qwen_image_2\.1_(bf16|int8_convrot)\.safetensors$/i.test(name));
    const qwenEncoders = inputOptions(info, 'CLIPLoader', 'clip_name').filter(name => /^qwen3vl_8b_(bf16|fp8_scaled|int8_convrot)\.safetensors$/i.test(name));
    const qwenVaes = inputOptions(info, 'VAELoader', 'vae_name').filter(name => name === 'qwen_image_2.1_vae_bf16.safetensors');
    const backgroundModels = inputOptions(info, 'LoadBackgroundRemovalModel', 'bg_removal_name');
    return { stats, info, checkpoints, shapeCheckpoints, qwenModels, qwenEncoders, qwenVaes, backgroundModels };
  }
  async upload(bytes, filename) {
    const data = new FormData();
    data.set('image', new Blob([bytes]), `qcharacter-${randomUUID()}${filename.slice(filename.lastIndexOf('.'))}`);
    data.set('type', 'input');
    data.set('overwrite', 'false');
    const response = await this.request('/upload/image', { method: 'POST', body: data }, 60000);
    const uploaded = await response.json();
    if (typeof uploaded.name !== 'string') throw new Error('ComfyUI 没有返回上传文件名。');
    return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
  }
  async download(output) {
    const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: 'output' });
    const response = await this.request(`/view?${params}`, {}, 120000);
    const limit = 256 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) throw new Error('生成文件超过 256MB，请降低模型精度后重试。');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error('生成文件超过 256MB。'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  watch(onProgress) {
    const wsUrl = new URL(this.base); wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'; wsUrl.pathname = '/ws'; wsUrl.searchParams.set('clientId', this.clientId);
    const socket = new WebSocket(wsUrl);
    socket.on('message', (raw, binary) => {
      if (binary) return;
      try { onProgress(JSON.parse(raw.toString())); } catch { /* Binary preview frames and unknown events are optional. */ }
    });
    socket.on('error', () => {}); // History polling still completes jobs when the socket is unavailable.
    return () => { socket.on('error', () => {}); socket.close(); };
  }
  async waitFor(promptId, kind, shouldStop, onState, collect = collectOutputs) {
    const deadline = Date.now() + 45 * 60 * 1000;
    let failures = 0;
    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error('QCHARACTER_CANCELLED');
      let history;
      try { history = await this.json(`/history/${encodeURIComponent(promptId)}`); failures = 0; }
      catch (error) { failures++; onState('连接中断，正在尝试找回任务…'); if (failures >= 5) throw error; }
      const entry = history?.[promptId];
      if (entry) {
        const failure = entry.status?.messages?.find(([type]) => ['execution_error', 'execution_interrupted'].includes(type));
        if (failure) throw new Error(failure[1]?.exception_message || 'ComfyUI 任务被中断。');
        if (entry.status?.status_str === 'error') throw new Error('ComfyUI 执行失败，请查看服务日志。');
        if (entry.status?.completed) {
          const outputs = collect(entry, kind);
          if (!outputs.length) throw new Error('任务已结束，但没有可用的输出文件。请检查保存节点。');
          return outputs;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('等待生成超过 45 分钟。任务可能仍在 ComfyUI 运行，可用任务编号找回。');
  }
  async cancel(promptId, targetedInterrupt) {
    await this.request('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
    if (targetedInterrupt) await this.request('/interrupt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt_id: promptId }) });
  }
}
