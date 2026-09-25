// 世界书域：绑定书目发现、条目读取、勾选持久化、TavernHelper 同步、
// 智能关键词抽取与跨角色钉选。WI 专属持久化归本模块；键常量的
// 单一事实源在 state.js，经 import 消费。
import { getContext } from "../../../../extensions.js";
import { saveSettingsDebounced, getRequestHeaders } from "../../../../../script.js";
import { store, safeLocalStorageSet, STORAGE_KEY_WI_STATE, STORAGE_KEY_PINNED_BOOKS } from "./state.js";
import { TEXT } from "./strings.js";

window.pwExtraBooks = [];
window.pwPinnedBooks = [];
try { window.pwPinnedBooks = JSON.parse(localStorage.getItem(STORAGE_KEY_PINNED_BOOKS)) || []; } catch { window.pwPinnedBooks = []; }
// Merge pinned books into extra on init
window.pwExtraBooks = [...window.pwPinnedBooks];

export const getPosFilterCode = (pos) => {
    if (!pos) return 'unknown';
    return pos;
};

export function getWiCacheKey() {
    const context = getContext();
    return context.characterId || 'global_no_char'; 
}

export function loadWiSelection(bookName) {
    const charKey = getWiCacheKey();
    if (store.wiSelectionCache[charKey] && store.wiSelectionCache[charKey][bookName]) {
        return store.wiSelectionCache[charKey][bookName]; 
    }
    return null;
}

export function saveWiSelection(bookName, uids) {
    const charKey = getWiCacheKey();
    if (!store.wiSelectionCache[charKey]) store.wiSelectionCache[charKey] = {};
    store.wiSelectionCache[charKey][bookName] = uids;
    safeLocalStorageSet(STORAGE_KEY_WI_STATE, JSON.stringify(store.wiSelectionCache));
}

export async function forceSavePersona(name, description) {
    const context = getContext();
    if (!context.powerUserSettings.personas) context.powerUserSettings.personas = {};
    context.powerUserSettings.personas[name] = description;
    context.powerUserSettings.persona_selected = name;
    const $nameInput = $('#your_name');
    const $descInput = $('#persona_description');
    if ($nameInput.length) $nameInput.val(name).trigger('input').trigger('change');
    if ($descInput.length) $descInput.val(description).trigger('input').trigger('change');
    const $h5Name = $('h5#your_name');
    if ($h5Name.length) $h5Name.text(name);
    await saveSettingsDebounced();
    return true;
}

// [Fix 15] Universal Smart Keyword Logic
export function generateSmartKeywords(name, content, staticTags = []) {
    let rawKeys = [name, ...staticTags];

    // 1. 尝试从内容中提取 "别名/昵称/Alias"
    const aliasMatch = content.match(/(?:别名|昵称|Alias)[:：]\s*(.*?)(\n|$)/i);
    if (aliasMatch) {
        // 支持中文逗号、英文逗号、顿号分隔
        const aliases = aliasMatch[1].split(/[,，、]/).map(s => s.trim()).filter(s => s);
        rawKeys.push(...aliases);
    }

    // 2. 智能拆分 (针对翻译名或西文名)
    if (name.includes('·')) {
        // 如 "希尔薇·波拉" -> 添加 "希尔薇"
        rawKeys.push(name.split('·')[0].trim());
    } else if (name.includes(' ')) {
        // 如 "John Doe" -> 添加 "John" (防止单字母触发)
        const firstName = name.split(' ')[0].trim();
        if (firstName.length > 1) rawKeys.push(firstName);
    }

    // 3. 去重、过滤短词(长度<=1)、移除空值
    return [...new Set(rawKeys)].filter(k => k && k.length > 1);
}

export function extractAllNpcNames(content) {
    const names = [];
    const regex = /姓名[:：]\s*(.*?)(\n|$)/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
        const name = m[1].trim();
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

export function generateSmartKeywordsMulti(names, content, staticTags = []) {
    let allKeys = [...staticTags];
    for (const name of names) {
        allKeys.push(...generateSmartKeywords(name, content, []));
    }
    return [...new Set(allKeys)].filter(k => k && k.length > 1);
}

export async function syncToWorldInfoViaHelper(userName, content) {
    if (!window.TavernHelper) return toastr.error(TEXT.TOAST_WI_ERROR);

    let targetBook = null;
    try {
        const charBooks = window.TavernHelper.getCharWorldbookNames('current');
        if (charBooks && charBooks.primary) targetBook = charBooks.primary;
        else if (charBooks && charBooks.additional && charBooks.additional.length > 0) targetBook = charBooks.additional[0];
    } catch (e) { }
    
    if (!targetBook) {
        const boundBooks = await getContextWorldBooks();
        if (boundBooks.length > 0) targetBook = boundBooks[0];
    }
    
    if (!targetBook) return toastr.warning(TEXT.TOAST_WI_FAIL);

    let entryTitle = "";
    let entryKeys = [];
    const isNpc = store.uiStateCache.generationMode === 'npc';

    if (isNpc) {
        let npcNames = extractAllNpcNames(content);
        if (npcNames.length === 0) {
            const fallback = prompt("无法自动识别 NPC 姓名，请输入：", "路人甲");
            if (!fallback) return;
            npcNames.push(fallback);
        }
        const displayName = npcNames.join('&');
        entryTitle = `NPC:${displayName}`;
        entryKeys = generateSmartKeywordsMulti(npcNames, content, ["NPC"]);
    } else {
        const nameMatch = content.match(/姓名:\s*(.*?)(\n|$)/);
        const finalUserName = nameMatch ? nameMatch[1].trim() : (userName || "User");
        entryTitle = `USER:${finalUserName}`;
        entryKeys = generateSmartKeywords(finalUserName, content, ["User"]);
    }

    try {
        const entries = await window.TavernHelper.getLorebookEntries(targetBook);
        const existingEntry = entries.find(e => e.comment === entryTitle);

        if (existingEntry) {
            await window.TavernHelper.setLorebookEntries(targetBook, [{ 
                uid: existingEntry.uid, 
                content: content, 
                keys: entryKeys, // 更新 Keys
                enabled: true 
            }]);
        } else {
            const newEntry = { 
                comment: entryTitle, 
                keys: entryKeys, 
                content: content, 
                enabled: true, 
                selective: true, 
                constant: false, 
                position: { type: 'before_character_definition' } 
            };
            await window.TavernHelper.createLorebookEntries(targetBook, [newEntry]);
        }
        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook, entryTitle) + `\n触发词: ${entryKeys.join(', ')}`);
    } catch (e) { 
        console.error("[PW] World Info Sync Error:", e);
        toastr.error("写入世界书失败: " + e.message); 
    }
}

export async function loadAvailableWorldBooks() {
    store.availableWorldBooks = [];
    if (window.TavernHelper && typeof window.TavernHelper.getWorldbookNames === 'function') {
        try { store.availableWorldBooks = window.TavernHelper.getWorldbookNames(); } catch { }
    }
    if (store.availableWorldBooks.length === 0 && window.world_names && Array.isArray(window.world_names)) {
        store.availableWorldBooks = window.world_names;
    }
    if (store.availableWorldBooks.length === 0) {
        try {
            const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
            if (r.ok) { const d = await r.json(); store.availableWorldBooks = d.world_names || d; }
        } catch (e) { }
    }
    store.availableWorldBooks = [...new Set(store.availableWorldBooks)].filter(x => x).sort();
}

export async function getContextWorldBooks(extras = []) {
    const context = getContext();
    const books = new Set(extras);
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        if (data.character_book?.name) books.add(data.character_book.name);
        if (data.extensions?.world) books.add(data.extensions.world);
        if (data.world) books.add(data.world);
        if (context.chatMetadata?.world_info) books.add(context.chatMetadata.world_info);
    }
    return Array.from(books).filter(Boolean);
}

export async function getWorldBookEntries(bookName) {
    if (window.TavernHelper && typeof window.TavernHelper.getLorebookEntries === 'function') {
        try {
            const entries = await window.TavernHelper.getLorebookEntries(bookName);
            return entries.map(e => ({ 
                uid: e.uid, 
                displayName: e.comment || (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) || "无标题", 
                content: e.content || "", 
                enabled: e.enabled,
                depth: (e.depth !== undefined && e.depth !== null) ? e.depth : (e.extensions?.depth || 0),
                position: e.position !== undefined ? e.position : 0,
                filterCode: getPosFilterCode(e.position) 
            }));
        } catch (e) { }
    }
    return [];
}

export function savePinnedBooks() {
    try { localStorage.setItem(STORAGE_KEY_PINNED_BOOKS, JSON.stringify(window.pwPinnedBooks)); } catch(e) { console.warn(e); }
}

export const getPosAbbr = (pos) => {
    if (pos === 0 || pos === 'before_character_definition') return 'PreChar';
    if (pos === 1 || pos === 'after_character_definition') return 'PostChar';
    if (pos === 2 || pos === 'before_example_messages') return 'PreEx';
    if (pos === 3 || pos === 'after_example_messages') return 'PostEx';
    if (pos === 4 || pos === 'before_author_note') return 'PreAN';
    if (pos === 5 || pos === 'after_author_note') return 'PostAN';
    if (pos === 6 || pos === 'at_depth_as_system') return '@Sys'; // 旧代码兼容
    if (String(pos).includes('at_depth')) return '@Depth';
    return '?';
};
