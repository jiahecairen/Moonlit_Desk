'use strict';
// Minimal OpenAI-compatible client (mlx_lm.server, Ollama, LM Studio, llama.cpp server).
const { validBaseUrl } = require('./config');

function endpoint(config, name) {
  return validBaseUrl(config.baseUrl) + '/' + name;
}

async function request(config, name, body, { signal, timeout = 300000 } = {}) {
  const signals = [AbortSignal.timeout(timeout)];
  if (signal) signals.push(signal);
  let response;
  try {
    response = await fetch(endpoint(config, name), {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.any(signals)
    });
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('已停止。'), { aborted: true });
    if (error.name === 'TimeoutError') throw new Error('本地模型响应超时，请确认模型已加载。');
    throw new Error('无法连接本地模型服务：' + validBaseUrl(config.baseUrl) + '。请先启动 mlx_lm.server、Ollama 或 LM Studio。');
  }
  if (!response.ok) {
    let detail = '';
    try { const data = await response.json(); detail = data.error?.message || data.error || data.detail || ''; } catch {}
    throw new Error('本地模型返回错误（HTTP ' + response.status + '）' + (detail ? '：' + String(detail).slice(0, 300) : '。'));
  }
  return response;
}

async function listModels(config, timeout = 3000) {
  const response = await request(config, 'models', null, { timeout });
  const data = await response.json();
  return (Array.isArray(data.data) ? data.data : []).map(item => String(item.id || '')).filter(Boolean).slice(0, 100);
}

function chatBody(config, messages, options, stream) {
  const body = { messages, stream, temperature: options.temperature ?? 0.6, max_tokens: options.maxTokens ?? 2048 };
  if (config.model) body.model = config.model;
  return body;
}

// Reasoning models (for example Qwen3) may emit <think>…</think>; those tokens never reach the article.
class ThinkFilter {
  constructor() { this.buffer = ''; this.thinking = false; }
  push(text) {
    this.buffer += text;
    let output = '';
    for (;;) {
      const tag = this.thinking ? '</think>' : '<think>';
      const index = this.buffer.indexOf(tag);
      if (index >= 0) {
        if (!this.thinking) output += this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + tag.length);
        this.thinking = !this.thinking;
        continue;
      }
      // Hold back a possible partial tag at the end of the buffer.
      let keep = 0;
      for (let size = Math.min(tag.length - 1, this.buffer.length); size > 0; size--) {
        if (tag.startsWith(this.buffer.slice(-size))) { keep = size; break; }
      }
      if (!this.thinking) output += this.buffer.slice(0, this.buffer.length - keep);
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      return output;
    }
  }
  end() {
    const rest = this.thinking ? '' : this.buffer;
    this.buffer = '';
    return rest;
  }
}

async function chat(config, messages, options = {}) {
  const response = await request(config, 'chat/completions', chatBody(config, messages, options, false), options);
  const data = await response.json();
  const filter = new ThinkFilter();
  return (filter.push(String(data.choices?.[0]?.message?.content || '')) + filter.end()).trim();
}

async function streamChat(config, messages, options = {}, onDelta) {
  const response = await request(config, 'chat/completions', chatBody(config, messages, options, true), options);
  const filter = new ThinkFilter();
  const decoder = new TextDecoder();
  let pending = '', output = '';
  const emit = text => { if (text) { output += text; onDelta(text); } };
  const handle = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    const delta = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content;
    if (typeof delta === 'string') emit(filter.push(delta));
  };
  try {
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach(handle);
    }
  } catch (error) {
    if (options.signal?.aborted) throw Object.assign(new Error('已停止。'), { aborted: true });
    throw new Error('本地模型连接中断：' + error.message);
  }
  handle(pending + decoder.decode());
  emit(filter.end());
  return output;
}

async function embed(config, texts, options = {}) {
  if (!config.embeddingModel || !texts.length) return [];
  const vectors = [];
  for (let index = 0; index < texts.length; index += 32) {
    const batch = texts.slice(index, index + 32);
    const response = await request(config, 'embeddings', { model: config.embeddingModel, input: batch }, options);
    const data = await response.json();
    const rows = (Array.isArray(data.data) ? data.data : []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== batch.length || rows.some(row => !Array.isArray(row.embedding))) throw new Error('嵌入模型返回的数据格式不正确。');
    vectors.push(...rows.map(row => row.embedding.map(Number)));
  }
  return vectors;
}

module.exports = { listModels, chat, streamChat, embed, ThinkFilter };
