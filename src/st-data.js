// ST 运行时取数适配层：聊天记录/角色信息/开场白/人格描述/头像的唯一取数通道，供生成域与 UI 双侧消费。
// TavernHelper/SillyTavern/window/$ 为宿主全局，不经 import；escapeRegexPW/applyTagFilters/estimateTokens
// 为本文件内部实现细节，不对外导出。
import { getContext } from "../../../../extensions.js";
import { store } from "./state.js";

export function getCharacterInfoText() {
    if (window.TavernHelper && window.TavernHelper.getCharData) {
        const charData = window.TavernHelper.getCharData('current');
        if (!charData) return "";
        let text = "";
        const MAX_FIELD_LENGTH = 1000000; 
        if (charData.description) text += `Description:\n${charData.description.substring(0, MAX_FIELD_LENGTH)}\n`;
        if (charData.personality) text += `Personality:\n${charData.personality.substring(0, MAX_FIELD_LENGTH)}\n`;
        if (charData.scenario) text += `Scenario:\n${charData.scenario.substring(0, MAX_FIELD_LENGTH)}\n`;
        return text;
    }
    const context = getContext();
    const charId = SillyTavern.getCurrentChatId ? SillyTavern.characterId : context.characterId; 
    if (charId === undefined || !context.characters[charId]) return "";
    const char = context.characters[charId];
    const data = char.data || char; 
    let text = "";
    if (data.description) text += `Description:\n${data.description}\n`;
    if (data.personality) text += `Personality:\n${data.personality}\n`;
    if (data.scenario) text += `Scenario:\n${data.scenario}\n`;
    return text;
}

export function getCharacterGreetingsList() {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined || !context.characters[charId]) return [];
    const char = context.characters[charId];
    const data = char.data || char;
    const list = [];
    if (data.first_mes) {
        list.push({ label: "开场白 #0", content: data.first_mes });
    }
    if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((greeting, index) => {
            list.push({ label: `开场白 #${index + 1}`, content: greeting });
        });
    }
    return list;
}

function escapeRegexPW(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function applyTagFilters(text, includeTags, excludeTags) {
    let result = String(text || "");
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    if (excludeTags && excludeTags.length > 0) {
        excludeTags.forEach(tag => {
            const re = new RegExp(`<${escapeRegexPW(tag)}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escapeRegexPW(tag)}>`, 'gi');
            result = result.replace(re, '');
        });
    }
    if (includeTags && includeTags.length > 0) {
        const incPattern = new RegExp(`<(${includeTags.map(escapeRegexPW).join('|')})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, 'gi');
        const matches = [...result.matchAll(incPattern)];
        if (matches.length > 0) result = matches.map(m => m[2]).join('\n\n');
    }
    result = result.replace(/<[^>]*>/g, '');
    return result.replace(/\n{3,}/g, '\n\n').trim();
}

function estimateTokens(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    const rest = text.replace(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '');
    const words = rest.split(/\s+/).filter(w => w.length > 0).length;
    return Math.ceil(cjk * 1.5 + words * 1.3);
}

export async function fetchChatHistoryFiltered(opts = {}) {
    if (!window.TavernHelper || !window.TavernHelper.getChatMessages) return { text: "", messages: [], tokenEstimate: 0 };

    const chatConf = store.uiStateCache.chatHistory || {};
    const floorFrom = opts.floorFrom ?? chatConf.floorFrom;
    const floorTo = opts.floorTo ?? chatConf.floorTo;
    const preset = opts.preset ?? chatConf.preset ?? '20';
    const excludeTags = opts.excludeTags ?? chatConf.excludeTags ?? [];
    const includeTags = opts.includeTags ?? chatConf.includeTags ?? [];

    let messages = [];
    try {
        if (floorFrom !== '' && floorTo !== '' && !isNaN(floorFrom) && !isNaN(floorTo)) {
            messages = window.TavernHelper.getChatMessages(`${floorFrom}-${floorTo}`);
        } else {
            const limit = preset === 'all' ? 9999 : parseInt(preset) || 20;
            messages = window.TavernHelper.getChatMessages(`-${limit}-{{lastMessageId}}`);
        }
    } catch (e) {
        console.warn("[PW] fetchChatHistoryFiltered error:", e);
        return { text: "", messages: [], tokenEstimate: 0 };
    }

    if (!Array.isArray(messages)) return { text: "", messages: [], tokenEstimate: 0 };

    const processed = messages.map(msg => {
        const role = msg.is_user ? 'User' : (msg.name || 'Char');
        const floorId = msg.message_id ?? '?';
        let content = msg.message || '';
        if (msg.is_user) {
            content = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '');
        } else {
            content = applyTagFilters(content, includeTags, excludeTags);
        }
        return { role, floorId, content: content.trim(), is_user: msg.is_user };
    }).filter(m => m.content.length > 0);

    const text = processed.map(m => `[#${m.floorId}] ${m.role}: ${m.content}`).join('\n\n');
    return { text, messages: processed, tokenEstimate: estimateTokens(text) };
}

export async function scanChatTags(limit = 30) {
    if (!window.TavernHelper || !window.TavernHelper.getChatMessages) return [];
    try {
        const msgs = window.TavernHelper.getChatMessages(`-${limit}-{{lastMessageId}}`);
        if (!Array.isArray(msgs)) return [];
        const tagCounts = {};
        msgs.forEach(msg => {
            if (msg.is_user) return;
            const text = String(msg.message || "");
            const matches = [...text.matchAll(/<([a-zA-Z0-9_\-\.]+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g)];
            matches.forEach(m => { tagCounts[m[1]] = (tagCounts[m[1]] || 0) + 1; });
        });
        return Object.entries(tagCounts).sort((a,b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
    } catch (e) { return []; }
}

export function getActivePersonaDescription() {
    const domVal = $('#persona_description').val();
    if (domVal !== undefined && domVal !== null) return domVal;
    const context = getContext();
    if (context && context.powerUserSettings) {
        if (context.powerUserSettings.persona_description) return context.powerUserSettings.persona_description;
        const selected = context.powerUserSettings.persona_selected;
        if (selected && context.powerUserSettings.personas && context.powerUserSettings.personas[selected]) {
            return context.powerUserSettings.personas[selected];
        }
    }
    return "";
}
