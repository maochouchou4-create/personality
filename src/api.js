// OpenAI 兼容 / Anthropic 端点的传输层：默认设置、超时与流式开关读取、
// max_tokens 按模型推断、SSE 流式解析——只管「怎么发请求」，不管「发什么内容」。
import { loadState } from "./state.js";

export const defaultSettings = {
    autoSwitchPersona: true, syncToWorldInfo: false,
    historyLimit: 9999, 
    apiSource: 'main',
    indepApiUrl: 'https://api.openai.com/v1', indepApiKey: '', indepApiModel: 'gpt-3.5-turbo',
    // 独立 API 请求超时（秒）。Claude / 第三方中转站输出长 YAML 经常 >2min，默认给 5 min。
    indepTimeout: 300,
    // 流式输出。默认开启，避免 Cloudflare / 酒馆后端 / 中转站的 504 Gateway Timeout。
    indepStream: true
    // max_tokens 由 resolveMaxTokens() 按模型名自动推断，不放在设置里
};

// 读取独立 API 的请求超时（秒）。优先级：DOM 输入 > 已保存配置 > defaultSettings > 硬编码 300。
// 做了 30–1800 秒的区间夹取，避免用户写 0 / 几秒这种废值把请求立刻打挂。
export function getIndepTimeoutSec() {
    let v = 0;
    try {
        const $el = (typeof $ === 'function') ? $('#pw-indep-timeout') : null;
        if ($el && $el.length) v = parseInt($el.val(), 10) || 0;
        if (!v) {
            const saved = loadState();
            if (saved && saved.localConfig && Number(saved.localConfig.indepTimeout) > 0) {
                v = Number(saved.localConfig.indepTimeout);
            }
        }
        if (!v && defaultSettings && Number(defaultSettings.indepTimeout) > 0) {
            v = Number(defaultSettings.indepTimeout);
        }
    } catch {}
    if (!v || v < 30) v = 300;      // 下限 30 秒，避免把请求秒 abort
    if (v > 1800) v = 1800;          // 上限 30 分钟，防止浏览器挂太久
    return v;
}

export function getIndepStreamEnabled() {
    try {
        const $el = (typeof $ === 'function') ? $('#pw-indep-stream') : null;
        if ($el && $el.length) return !!$el.prop('checked');
        const saved = loadState();
        if (saved && saved.localConfig && typeof saved.localConfig.indepStream === 'boolean') {
            return saved.localConfig.indepStream;
        }
    } catch {}
    return true;
}

// 根据模型名自动推断合理的 max_tokens，无需用户配置。
// 若用户想强制覆盖，仍保留隐藏入口：手动在 DevTools 给 localStorage 的
// pw_state_* → localConfig.indepMaxTokensOverride 写一个正整数即可。
// （特地换了 key，避免 v3.4.3 残留的 indepMaxTokens=32000 把 Claude 3.5 打成 400）
// 返回 0 表示"不发送 max_tokens 字段"，仅 OpenAI 兼容分支可用；Anthropic 必填故永远不返回 0。
export function resolveMaxTokens(modelName, isAnthropic) {
    // 1) 隐藏的手动覆盖（仅极端场景使用）
    try {
        const saved = loadState();
        if (saved && saved.localConfig && Number.isInteger(saved.localConfig.indepMaxTokensOverride)) {
            const v = saved.localConfig.indepMaxTokensOverride;
            if (v >= 0 && v <= 200000) return v;
        }
    } catch {}

    const m = String(modelName || '').toLowerCase();

    if (isAnthropic) {
        // Claude 4 / 4.x 系列 (sonnet-4, opus-4, sonnet-4-5, opus-4-1, haiku-4-5 等)：
        // 上限 32K~64K，取安全值 32000
        if (/claude-(?:[a-z]+-)?4(?:[-.]|$|\b)/.test(m)) return 32000;
        // Claude 3.7 Sonnet：上限 64K，取安全值 32000
        if (/claude-3[-.]7/.test(m)) return 32000;
        // Claude 3.5 (Sonnet / Haiku)：硬限 8192
        if (/claude-3[-.]5/.test(m)) return 8192;
        // Claude 3 原版 (opus/sonnet/haiku 20240229~20240307)：硬限 4096
        if (/claude-3-(?:opus|sonnet|haiku)/.test(m)) return 4096;
        // Claude 2 / 未识别型号：安全中值 8192
        return 8192;
    }

    // OpenAI 兼容分支（含 GPT / Gemini / DeepSeek / OpenRouter / 中转站 / 本地模型）
    // 返回 0 让调用端省略 max_tokens 字段，服务端使用模型默认最大值 —— 对长 YAML 最友好。
    return 0;
}

// SSE 流式响应解析。兼容：
//   - OpenAI 兼容：`data: {"choices":[{"delta":{"content":"..."}}]}` / `data: [DONE]`
//   - Anthropic  ：`event: content_block_delta` + `data: {"delta":{"type":"text_delta","text":"..."}}`
//   - 忽略 ping / 心跳 / 空 event，对不完整 JSON 静默跳过
// 每收到 chunk 就回调 onDelta(text) 供 UI 渐进显示（目前 Persona Weaver 不用，留做扩展）。
export async function readSSEResponse(res, isAnthropic, onDelta) {
    if (!res.body || !res.body.getReader) {
        const text = await res.text();
        throw new Error("当前浏览器不支持 Fetch 流式读取，无法解析流式响应。请关闭『流式输出』再试。原始返回前 200 字: " + text.slice(0, 200));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
    let sawAnyDelta = false;

    const processEvent = (event) => {
        const lines = event.split('\n');
        for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (!line.startsWith('data:')) continue;
            const dataStr = line.substring(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            let json;
            try { json = JSON.parse(dataStr); } catch { continue; }

            let piece = '';
            if (isAnthropic) {
                // content_block_delta: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
                if (json.type === 'content_block_delta' && json.delta) {
                    if (json.delta.type === 'text_delta' && typeof json.delta.text === 'string') {
                        piece = json.delta.text;
                    } else if (typeof json.delta.text === 'string') {
                        piece = json.delta.text;
                    }
                }
                // 有些中转站直接包 message_delta.delta.text
                else if (json.type === 'message_delta' && json.delta && typeof json.delta.text === 'string') {
                    piece = json.delta.text;
                }
                // 有些把文本放在 completion 字段
                else if (typeof json.completion === 'string') {
                    piece = json.completion;
                }
                // 错误帧
                else if (json.type === 'error' && json.error) {
                    throw new Error(`Anthropic 流式错误: ${json.error.message || JSON.stringify(json.error)}`);
                }
            } else {
                // OpenAI 兼容
                const choices = json.choices;
                if (Array.isArray(choices) && choices[0]) {
                    const delta = choices[0].delta || choices[0].message || {};
                    if (typeof delta.content === 'string') {
                        piece = delta.content;
                    } else if (Array.isArray(delta.content)) {
                        // 有些兼容实现用数组：[{type:'text', text:'...'}]
                        piece = delta.content.map(b => (b && typeof b.text === 'string') ? b.text : '').join('');
                    }
                }
                // 错误帧（部分中转站在 stream 里塞 error 对象）
                if (json.error && (json.error.message || typeof json.error === 'string')) {
                    throw new Error(`API 流式错误: ${json.error.message || json.error}`);
                }
            }
            if (piece) {
                fullText += piece;
                sawAnyDelta = true;
                if (typeof onDelta === 'function') { try { onDelta(piece); } catch {} }
            }
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 事件以空行分隔，同时兼容 \r\n\r\n
        let idx;
        while (true) {
            const a = buffer.indexOf('\n\n');
            const b = buffer.indexOf('\r\n\r\n');
            if (a === -1 && b === -1) break;
            idx = (a === -1) ? b : (b === -1 ? a : Math.min(a, b));
            const sep = (idx === b) ? 4 : 2;
            const event = buffer.substring(0, idx);
            buffer = buffer.substring(idx + sep);
            if (event.trim().length > 0) processEvent(event);
        }
    }
    // 尾巴可能没有空行结束，补处理一次
    buffer += decoder.decode();
    if (buffer.trim().length > 0) processEvent(buffer);

    if (!fullText && !sawAnyDelta) {
        throw new Error("流式响应为空（可能被反代吞掉或模型未返回文本）。可尝试关闭『流式输出』切回非流式模式。");
    }
    return fullText;
}
