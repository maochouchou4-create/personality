// 世界书域：绑定书目发现、条目读取、勾选持久化、人设写回世界书、
// 智能关键词抽取与跨角色钉选。WI 专属持久化归本模块；键常量的
// 单一事实源在 state.js，经 import 消费。
// 宿主操作全部走 getContext() 挂载方法，不新增宿主模块 import（check-imports 白名单只认 extensions/script）。
import { getContext } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { store, safeLocalStorageSet, STORAGE_KEY_WI_STATE, STORAGE_KEY_PINNED_BOOKS } from "./state.js";
import { TEXT } from "./strings.js";
import { error as logError, warn as logWarn } from "./log.js";

window.pwExtraBooks = [];
window.pwPinnedBooks = [];
try { window.pwPinnedBooks = JSON.parse(localStorage.getItem(STORAGE_KEY_PINNED_BOOKS)) || []; } catch { window.pwPinnedBooks = []; }
// Merge pinned books into extra on init
window.pwExtraBooks = [...window.pwPinnedBooks];

export function getPosAbbr(pos) {
    // 原生数字枚举（TauriTavern world-info.js：0 角色前/1 角色后/2 AN前/3 AN后/4 @深度/5 样例前/6 样例后）
    return ({ 0: 'PreChar', 1: 'PostChar', 2: 'PreAN', 3: 'PostAN', 4: '@Depth', 5: 'PreEx', 6: 'PostEx' })[pos] ?? '?';
}

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

// 人设写回世界书：读全量 → 定位/新建 USER 条目 → saveWorldInfo(immediately=true) 整本回写。
// immediately=true 时 await 返回即宿主已确认 HTTP 落盘，链上再无用户代码——成败即真判据，
// 不再有「写入成功却报失败」的中间抛错面（旧依赖链的 catch-all 误报根因）。
export async function syncPersonaToWorldInfo(userName, content) {
    const targetBook = (await getContextWorldBooks())[0];
    if (!targetBook) return toastr.warning(TEXT.TOAST_WI_FAIL);

    const nameMatch = content.match(/姓名:\s*(.*?)(\n|$)/);
    const finalUserName = nameMatch ? nameMatch[1].trim() : (userName || "User");
    const entryTitle = `USER:${finalUserName}`;
    const entryKeys = generateSmartKeywords(finalUserName, content, ["User"]);

    try {
        const data = await getContext().loadWorldInfo(targetBook);
        const entries = Object.values(data.entries || {});
        const existingEntry = entries.find(e => e.comment === entryTitle);

        if (existingEntry) {
            // 原生条目字段：key 是数组、disable 是反向布尔（与旧依赖的 keys/enabled 语义不同，映射反了＝条目静默失效）
            existingEntry.content = content;
            existingEntry.key = entryKeys;
            existingEntry.disable = false;
        } else {
            const uid = entries.reduce((m, e) => Math.max(m, Number(e.uid) || 0), -1) + 1;
            const displayIndex = entries.reduce((m, e) => Math.max(m, Number(e.displayIndex) || 0), -1) + 1;
            // 字段全集照宿主 newWorldInfoEntryTemplate 形态（缺字段会让编辑器/保存链行为未定义）
            data.entries[String(uid)] = {
                uid, displayIndex,
                addMemo: true, automationId: "", caseSensitive: null,
                comment: entryTitle, constant: false, content,
                cooldown: 0, delay: 0, delayUntilRecursion: false,
                depth: 4, disable: false,
                excludeRecursion: false, preventRecursion: false,
                group: "", groupOverride: false, groupWeight: 100,
                ignoreBudget: false, key: entryKeys, keysecondary: [],
                matchCharacterDepthPrompt: false, matchCharacterDescription: false,
                matchCharacterPersonality: false, matchCreatorNotes: false,
                matchPersonaDescription: false, matchScenario: false,
                matchWholeWords: null, order: 100, outletName: "",
                position: 0, probability: 100, role: null,
                scanDepth: null, selective: true, selectiveLogic: 0,
                sticky: 0, triggers: [], useGroupScoring: null,
                useProbability: true, vectorized: false,
            };
        }
        await getContext().saveWorldInfo(targetBook, data, true);
        toastr.success(TEXT.TOAST_WI_SUCCESS(targetBook, entryTitle) + `\n触发词: ${entryKeys.join(', ')}`);
    } catch (e) {
        logError("World Info Sync Error:", e);
        toastr.error(TEXT.TOAST_WI_WRITE_FAIL + e.message);
    }
}

export async function loadAvailableWorldBooks() {
    // 单一事实源＝宿主启动时 updateWorldInfoList 装载的全量书目快照
    store.availableWorldBooks = getContext().getWorldInfoNames();
    store.availableWorldBooks = [...new Set(store.availableWorldBooks)].filter(x => x).sort();
}

export async function getContextWorldBooks(extras = []) {
    const context = getContext();
    const books = new Set(extras);
    const charId = context.characterId;
    if (charId !== undefined && context.characters[charId]) {
        const char = context.characters[charId];
        const data = char.data || char;
        // 主书（extensions.world）必须排在内嵌书之前——写回世界书取首个绑定书
        if (data.extensions?.world) books.add(data.extensions.world);
        if (data.character_book?.name) books.add(data.character_book.name);
        if (data.world) books.add(data.world);
        if (context.chatMetadata?.world_info) books.add(context.chatMetadata.world_info);
    }
    return Array.from(books).filter(Boolean);
}

export async function getWorldBookEntries(bookName) {
    try {
        const data = await getContext().loadWorldInfo(bookName);
        return Object.values(data.entries || {}).map(e => ({
            uid: e.uid,
            displayName: e.comment || (Array.isArray(e.key) ? e.key.join(', ') : e.key) || "无标题",
            content: e.content || "",
            enabled: !e.disable,
            depth: e.depth ?? 0,
            position: e.position ?? 'unknown'
        }));
    } catch (e) {
        // 单书读取失败（不存在/宿主异常）不阻断其余书目，消费方按空书处理
        logWarn("Failed to load world book entries:", bookName, e);
        return [];
    }
}

export function savePinnedBooks() {
    try { localStorage.setItem(STORAGE_KEY_PINNED_BOOKS, JSON.stringify(window.pwPinnedBooks)); } catch(e) { logWarn(e); }
}
