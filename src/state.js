// 内存状态单容器（store）与 localStorage 持久化簇。
// store 必须整体导入后做属性赋值——ESM 具名导入绑定只读，散装 let 无法跨模块改写。
// STORAGE_KEY_* 与用户浏览器存量数据是持久化契约：键名一经发布不可再改。
// 唯一的 ST 宿主依赖：saveHistory 入库时需从当前角色上下文补全标题。
import { DEFAULT_TEMPLATES, DEFAULT_PROMPTS, FALLBACK_SYSTEM_PROMPT } from "./prompts.js";
import { TEXT } from "./strings.js";
import { getContext } from "../../../../extensions.js";

// Storage Keys
const STORAGE_KEY_HISTORY = 'pw_history_v29_new_template'; 
const STORAGE_KEY_STATE = 'pw_state_v20';
const STORAGE_KEY_TEMPLATE = 'pw_template_v6_new_yaml'; 
const STORAGE_KEY_PROMPTS = 'pw_prompts_v21_restore_edit'; 
export const STORAGE_KEY_WI_STATE = 'pw_wi_selection_v1';
const STORAGE_KEY_UI_STATE = 'pw_ui_state_v4_preset';          
const STORAGE_KEY_DATA_USER = 'pw_data_user_v1'; 
export const STORAGE_KEY_PINNED_BOOKS = 'pw_pinned_books_v1';
const STORAGE_KEY_AVATAR_IMAGES = 'pw_avatar_images_v1';

export const store = {
    historyCache: [],
    promptsCache: {
        templateGen: DEFAULT_PROMPTS.templateGen,
        templateRefine: DEFAULT_PROMPTS.templateGen,
        personaGen: DEFAULT_PROMPTS.personaGen,
        chatInfer: DEFAULT_PROMPTS.chatInfer,
        initial: FALLBACK_SYSTEM_PROMPT
    },
    availableWorldBooks: [],
    isEditingTemplate: false,
    isProcessing: false,
    currentGreetingsList: [],
    wiSelectionCache: {},
    uiStateCache: { templateExpanded: true, generationPreset: 'current', avatarRef: { enabled: false, selectedIds: [] }, chatHistory: { enabled: false, preset: '20', floorFrom: '', floorTo: '', excludeTags: [], includeTags: [] } },
    avatarImagesCache: [], // [{id, name, base64, tags:['user'], addedAt}]
    currentUserAvatarBase64: null, // pre-loaded on panel open
    historyPage: 1,
    lastRefineRequest: "",
    userContext: { template: DEFAULT_TEMPLATES.user, request: "", result: "", hasResult: false },
    currentDiffBlocks: [],
};

export const getCurrentTemplate = () => {
    return store.userContext.template;
}

// ============================================================================
// 存储与系统函数
// ============================================================================

export function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            toastr.error(TEXT.TOAST_QUOTA_ERROR);
        }
    }
}

export function loadData() {
    try { store.historyCache = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY)) || []; } catch { store.historyCache = []; }
    try {
        const p = JSON.parse(localStorage.getItem(STORAGE_KEY_PROMPTS));
        const migrateTemplatePrompt = (stored, def) =>
            (stored && stored.includes('{{userRequirements}}')) ? stored : def;
        // v3.4.6 引入的"生命周期/时间线豁免"标识，用于识别旧版默认值
        const V345_PROHIBIT_SIG = 'Do NOT output empty strings, "未知", "unknown", "N/A", "待定", "TBD", "暂无", null, "-", or placeholders.';
        const hasLifecycleExc = (s) => s.includes('LIFECYCLE / TIMELINE EXCEPTION') || s.includes('尚未发生（角色');

        // 聊天推断 Prompt 迁移：
        //  - v3.4.3 及更早旧版（无 MANDATORY COMPLETENESS）→ 升级到新默认
        //  - v3.4.4/v3.4.5 旧默认（有 MANDATORY 但无 LIFECYCLE EXCEPTION，且保留 v3.4.5 原句）→ 升级到新默认
        //  - 用户深度自定义 → 保留
        const migrateChatInferPrompt = (stored, def) => {
            if (!stored) return def;
            const hasOldRule = stored.includes('Base the profile ONLY on evidence from the chat history. Do NOT invent unsupported traits.')
                || stored.includes('If certain fields cannot be determined, make reasonable inferences.');
            const hasNewGuard = stored.includes('MANDATORY COMPLETENESS') || stored.includes('NEVER leave any field blank');
            if (hasOldRule && !hasNewGuard) return def;
            if (hasNewGuard && !hasLifecycleExc(stored) && stored.includes(V345_PROHIBIT_SIG)) return def;
            return stored;
        };
        // 生成/润色 Prompt 迁移：
        //  - v3.4.3 及更早默认（无 MANDATORY COMPLETENESS / 无 PATCH MODE）→ 升级，修复纯润色字段被清空
        //  - v3.4.4/v3.4.5 旧默认（有 MANDATORY 但无 LIFECYCLE EXCEPTION，且保留 v3.4.5 原句）→ 升级，
        //    解决"角色未到中年阶段时字段被强行编造"以及自定义模板里同类时间锁字段的问题
        //  - 用户深度自定义内容保持不变
        const migrateGenPrompt = (stored, def, signature) => {
            if (!stored) return def;
            const hasNewGuard = stored.includes('MANDATORY COMPLETENESS') || stored.includes('NEVER leave any field blank');
            if (hasNewGuard) {
                if (!hasLifecycleExc(stored) && stored.includes(signature) && stored.includes(V345_PROHIBIT_SIG)) {
                    return def;
                }
                return stored;
            }
            const looksLikeOldDefault = stored.includes(signature)
                && stored.includes('Output ONLY the YAML data matching the schema.');
            if (looksLikeOldDefault) return def;
            return stored;
        };
        store.promptsCache = {
            templateGen: migrateTemplatePrompt(p && p.templateGen, DEFAULT_PROMPTS.templateGen),
            templateRefine: DEFAULT_PROMPTS.templateGen,
            personaGen: migrateGenPrompt(p && p.personaGen, DEFAULT_PROMPTS.personaGen, '[Task: Generate/Refine User Profile]'),
            chatInfer: migrateChatInferPrompt(p && p.chatInfer, DEFAULT_PROMPTS.chatInfer),
            initial: (p && p.initial) ? p.initial : FALLBACK_SYSTEM_PROMPT
        };
    } catch { 
        store.promptsCache = { 
            templateGen: DEFAULT_PROMPTS.templateGen,
            templateRefine: DEFAULT_PROMPTS.templateGen,
            personaGen: DEFAULT_PROMPTS.personaGen,
            chatInfer: DEFAULT_PROMPTS.chatInfer,
            initial: FALLBACK_SYSTEM_PROMPT 
        }; 
    }
    try { store.wiSelectionCache = JSON.parse(localStorage.getItem(STORAGE_KEY_WI_STATE)) || {}; } catch { store.wiSelectionCache = {}; }
    
    // [Updated] Load UI State with Preset info + chatHistory config
    const defaultUiState = { templateExpanded: true, generationPreset: 'current', avatarRef: { enabled: false, selectedIds: [] }, chatHistory: { enabled: false, preset: '20', floorFrom: '', floorTo: '', excludeTags: [], includeTags: [] } };
    try {
        store.uiStateCache = JSON.parse(localStorage.getItem(STORAGE_KEY_UI_STATE)) || defaultUiState;
        if (!store.uiStateCache.chatHistory) store.uiStateCache.chatHistory = { enabled: false, preset: '20', floorFrom: '', floorTo: '', excludeTags: [], includeTags: [] };
        if (!store.uiStateCache.avatarRef || typeof store.uiStateCache.avatarRef === 'boolean') {
            store.uiStateCache.avatarRef = { enabled: !!store.uiStateCache.avatarRef, selectedIds: [] };
        } else if (!Array.isArray(store.uiStateCache.avatarRef.selectedIds)) {
            store.uiStateCache.avatarRef.selectedIds = [];
        }
    } catch { store.uiStateCache = defaultUiState; }
    // 清理主题系统遗留的存量数据（theme 字段已无任何消费者）
    delete store.uiStateCache.theme;
    localStorage.removeItem('pw_custom_themes_v1');

    try { store.avatarImagesCache = JSON.parse(localStorage.getItem(STORAGE_KEY_AVATAR_IMAGES)) || []; } catch { store.avatarImagesCache = []; }

    // Load Isolated Context Data
    try {
        const u = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA_USER));
        store.userContext = u || { template: DEFAULT_TEMPLATES.user, request: "", result: "", hasResult: false };
        if(!u) {
            const oldT = localStorage.getItem(STORAGE_KEY_TEMPLATE);
            if(oldT && oldT.length > 50) store.userContext.template = oldT;
        }
    } catch { store.userContext = { template: DEFAULT_TEMPLATES.user, request: "", result: "", hasResult: false }; }
}

export function saveData() {
    safeLocalStorageSet(STORAGE_KEY_HISTORY, JSON.stringify(store.historyCache));
    safeLocalStorageSet(STORAGE_KEY_PROMPTS, JSON.stringify(store.promptsCache));
    safeLocalStorageSet(STORAGE_KEY_UI_STATE, JSON.stringify(store.uiStateCache));
    safeLocalStorageSet(STORAGE_KEY_DATA_USER, JSON.stringify(store.userContext));
}

export function saveHistory(item) {
    const limit = 1000; 

    if (!item.title || item.title === "未命名") {
        const context = getContext();
        const userName = $('.persona_name').first().text().trim() || "User";
        const charName = context.characters[context.characterId]?.name || "Char";
        
        if (item.data && item.data.type === 'template') {
            item.title = `User模版 (${charName})`;
        } else {
            item.title = `${userName} & ${charName}`;
        }
    }
    
    if (!item.data.genType) {
        item.data.genType = item.data.type === 'template' ? 'user_template' : 'user_persona';
    }

    store.historyCache.unshift(item);
    if (store.historyCache.length > limit) store.historyCache = store.historyCache.slice(0, limit);
    saveData();
}

export function saveState(data) { safeLocalStorageSet(STORAGE_KEY_STATE, JSON.stringify(data)); }
export function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; } }

export function saveAvatarImages() { safeLocalStorageSet(STORAGE_KEY_AVATAR_IMAGES, JSON.stringify(store.avatarImagesCache)); }
