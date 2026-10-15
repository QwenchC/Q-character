import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { ComfyClient, normalizeServer, inputOptions } from '../electron/comfy.mjs';

test('能力读取支持旧版数组与新版 COMBO，并正确提取可选模型', () => {
  const info = { Loader: { input: { required: { model: ['COMBO', { options: ['birefnet.safetensors'] }] }, optional: { encoder: [['qwen3vl_8b_bf16.safetensors']] } } } };
  assert.deepEqual(inputOptions(info, 'Loader', 'model'), ['birefnet.safetensors']);
  assert.deepEqual(inputOptions(info, 'Loader', 'encoder'), ['qwen3vl_8b_bf16.safetensors']);
  assert.deepEqual(inputOptions(info, 'Missing', 'model'), []);
});

test('连接地址只允许无凭据的 HTTP(S) 服务根地址', () => {
  assert.equal(normalizeServer('http://127.0.0.1:8188/'), 'http://127.0.0.1:8188');
  for (const input of ['file:///C:/', 'https://user:secret@example.com/', 'https://example.com/path', 'https://example.com/?a=b']) assert.throws(() => normalizeServer(input));
});
test('能力检查拒绝伪装成成功的 HTML 或无效服务', async () => {
  const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await assert.rejects(new ComfyClient(`http://127.0.0.1:${server.address().port}`).capabilities(), /有效的 ComfyUI/); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('取消仅删除自己的队列项，并用 prompt_id 定向中断', async () => {
  const requests = [];
  const server = http.createServer(async (request, response) => { let body = ''; for await (const chunk of request) body += chunk; requests.push({ url: request.url, body: JSON.parse(body) }); response.end('{}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new ComfyClient(`http://127.0.0.1:${server.address().port}`);
    await client.cancel('mine', true);
    assert.deepEqual(requests, [{ url: '/queue', body: { delete: ['mine'] } }, { url: '/interrupt', body: { prompt_id: 'mine' } }]);
    requests.length = 0; await client.cancel('mine', false);
    assert.deepEqual(requests, [{ url: '/queue', body: { delete: ['mine'] } }]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('服务端执行异常会成为可见失败，不被错误地视作无输出成功', async () => {
  const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ mine: { status: { completed: false, messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] } } })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await assert.rejects(new ComfyClient(`http://127.0.0.1:${server.address().port}`).waitFor('mine', 'shape', () => false, () => {}), /CUDA out of memory/); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
