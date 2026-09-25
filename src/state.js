// 内存状态单容器（store）与 localStorage 持久化簇。本模块是纯数据/持久化叶子，不依赖 ST 宿主。
// store 必须整体导入后做属性赋值——ESM 具名导入绑定只读，散装 let 无法跨模块改写。
// STORAGE_KEY_* 与用户浏览器存量数据是持久化契约：键名一经发布不可再改。
import { DEFAULT_PROMPTS, FALLBACK_SYSTEM_PROMPT } from "./prompts.js";
import { TEXT } from "./strings.js";

// Storage Keys
const STORAGE_KEY_STATE = 'pw_state_v20';
const STORAGE_KEY_PROMPTS = 'pw_prompts_v21_restore_edit'; 
export const STORAGE_KEY_WI_STATE = 'pw_wi_selection_v1';
const STORAGE_KEY_UI_STATE = 'pw_ui_state_v4_preset';          
const STORAGE_KEY_DATA_USER = 'pw_data_user_v1'; 
export const STORAGE_KEY_PINNED_BOOKS = 'pw_pinned_books_v1';

// 已删除特性独占的持久化键（手动模板、外貌参考图、NPC 上下文、历史草稿）。键名是历史发布过的契约，只能写死于
// 此处做存量清理——loadData 时逐次 removeItem，幂等。
const RETIRED_STORAGE_KEYS = ['pw_template_v6_new_yaml', 'pw_avatar_images_v1', 'pw_data_npc_v1', 'pw_history_v29_new_template'];

// userContext 的规范形状（编辑器工作现场暂存：需求框/结果框，refine 的目标缓冲区即 result）；
// 旧形状的 template/curatedSchema 字段已淘汰，loadData 按字段重建对象即完成迁移。
const defaultUserContext = () => ({ request: "", result: "", hasResult: false });

export const store = {
    promptsCache: {
        personaGen: DEFAULT_PROMPTS.personaGen,
        curator: DEFAULT_PROMPTS.curator,
        initial: FALLBACK_SYSTEM_PROMPT
    },
    availableWorldBooks: [],
    isProcessing: false,
    currentGreetingsList: [],
    wiSelectionCache: {},
    uiStateCache: { generationPreset: 'current' },
    lastRefineRequest: "",
    userContext: defaultUserContext(),
    currentDiffBlocks: [],
};

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
    try {
        const p = JSON.parse(localStorage.getItem(STORAGE_KEY_PROMPTS));
        // v3.4.6 引入的"生命周期/时间线豁免"标识，用于识别旧版默认值
        const V345_PROHIBIT_SIG = 'Do NOT output empty strings, "未知", "unknown", "N/A", "待定", "TBD", "暂无", null, "-", or placeholders.';
        const hasLifecycleExc = (s) => s.includes('LIFECYCLE / TIMELINE EXCEPTION') || s.includes('尚未发生（角色');

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
        // 按当前键集合重建缓存对象：存量里的退役键（旧版模板生成提示词）随之自然剥掉，无需逐键删除。
        store.promptsCache = {
            personaGen: migrateGenPrompt(p && p.personaGen, DEFAULT_PROMPTS.personaGen, '[Task: Generate/Refine User Profile]'),
            curator: (p && p.curator) ? p.curator : DEFAULT_PROMPTS.curator,
            initial: (p && p.initial) ? p.initial : FALLBACK_SYSTEM_PROMPT
        };
    } catch { 
        store.promptsCache = { 
            personaGen: DEFAULT_PROMPTS.personaGen,
            curator: DEFAULT_PROMPTS.curator,
            initial: FALLBACK_SYSTEM_PROMPT 
        }; 
    }
    try { store.wiSelectionCache = JSON.parse(localStorage.getItem(STORAGE_KEY_WI_STATE)) || {}; } catch { store.wiSelectionCache = {}; }
    
    // Load UI State with Preset info
    const defaultUiState = { generationPreset: 'current' };
    try {
        store.uiStateCache = JSON.parse(localStorage.getItem(STORAGE_KEY_UI_STATE)) || defaultUiState;
    } catch { store.uiStateCache = defaultUiState; }
    // 清理已删除特性的存量字段（模板编辑器 / 外貌参考图 / NPC 模式切换 / 聊天注入）与主题系统遗留（theme 字段已无任何消费者）
    delete store.uiStateCache.templateExpanded;
    delete store.uiStateCache.avatarRef;
    delete store.uiStateCache.generationMode;
    delete store.uiStateCache.chatHistory;
    delete store.uiStateCache.theme;
    localStorage.removeItem('pw_custom_themes_v1');
    RETIRED_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));

    // Load Isolated Context Data（逐字段重建：旧形状的 template/curatedSchema 被丢弃，缺字段补默认，反复加载幂等）
    try {
        const u = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA_USER));
        store.userContext = {
            request: (u && u.request) || "",
            result: (u && u.result) || "",
            hasResult: !!(u && u.hasResult)
        };
    } catch { store.userContext = defaultUserContext(); }
}

export function saveData() {
    safeLocalStorageSet(STORAGE_KEY_PROMPTS, JSON.stringify(store.promptsCache));
    safeLocalStorageSet(STORAGE_KEY_UI_STATE, JSON.stringify(store.uiStateCache));
    safeLocalStorageSet(STORAGE_KEY_DATA_USER, JSON.stringify(store.userContext));
}

export function saveState(data) { safeLocalStorageSet(STORAGE_KEY_STATE, JSON.stringify(data)); }
export function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE)) || {}; } catch { return {}; } }
