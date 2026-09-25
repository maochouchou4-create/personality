
import { getContext } from "../../../extensions.js";
import { callPopup } from "../../../../script.js";
import { DEFAULT_TEMPLATES } from "./src/prompts.js";
import { TEXT } from "./src/strings.js";
import { store, getCurrentTemplate, loadData, saveData, saveHistory, saveState, loadState, saveAvatarImages } from "./src/state.js";
import { parseYamlToBlocks } from "./src/yaml.js";
import { getCharacterInfoText, getCharacterGreetingsList, fetchChatHistoryFiltered, scanChatTags, getActivePersonaDescription, fetchAvatarAsBase64 } from "./src/st-data.js";
import { defaultSettings } from "./src/api.js";
import { runGeneration, collectContextData, getPresetHintText } from "./src/generation.js";
import { forceSavePersona, syncToWorldInfoViaHelper, loadAvailableWorldBooks, getContextWorldBooks, getWorldBookEntries, loadWiSelection, saveWiSelection, savePinnedBooks, getPosFilterCode, getPosAbbr } from "./src/world-info.js";
import { renderDiffComparison, assembleDiffResult } from "./src/diff.js";

const BUTTON_ID = 'pw_persona_tool_btn';
const HISTORY_PER_PAGE = 20;

// ============================================================================
// 工具函数
// ============================================================================
const forcePaint = () => new Promise(resolve => setTimeout(resolve, 50));

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

function compressImage(base64, maxSize = 512, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                const ratio = Math.min(maxSize / w, maxSize / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
    });
}

function autoBindGreetings() {
    if (window.TavernHelper && window.TavernHelper.getChatMessages) {
        try {
            const msgs = window.TavernHelper.getChatMessages(0, { include_swipes: true });
            if (msgs && msgs.length > 0) {
                const swipeId = msgs[0].swipe_id; 
                if (swipeId !== undefined && swipeId !== null) {
                    if ($(`#pw-greetings-select option[value="${swipeId}"]`).length > 0) {
                        $('#pw-greetings-select').val(swipeId);
                        
                        // [Fix 8] Set value but keep collapsed by default
                        if (store.currentGreetingsList[swipeId]) {
                            $('#pw-greetings-preview').val(store.currentGreetingsList[swipeId].content).hide();
                            $('#pw-greetings-toggle-bar').show().html('<i class="fa-solid fa-angle-down"></i> 展开预览');
                        }
                        
                        console.log(`[PW] Auto-bound greetings to Swipe #${swipeId}`);
                    }
                }
            }
        } catch (e) {
            console.warn("[PW] Auto-bind greetings failed:", e);
        }
    }
}

// ============================================================================
// 4. UI 渲染 logic
// ============================================================================

function renderAvatarStrip() {
    const isNpc = store.uiStateCache.generationMode === 'npc';
    const $strip = $('#pw-avatar-strip');
    if (!$strip.length) return;
    $strip.empty();
    const items = [];
    if (!isNpc && store.currentUserAvatarBase64) {
        items.push({ id: '__user_current__', base64: store.currentUserAvatarBase64, name: 'User 当前头像' });
    }
    const tagFilter = isNpc ? 'npc' : 'user';
    store.avatarImagesCache.filter(img => img.tags && img.tags.includes(tagFilter)).forEach(img => items.push(img));
    if (items.length === 0) {
        $strip.html('<span style="font-size:0.75em; opacity:0.4; white-space:nowrap;">暂无图片，前往参考页上传</span>');
        return;
    }
    const sel = store.uiStateCache.avatarRef.selectedIds || [];
    items.forEach(item => {
        const isSelected = sel.includes(item.id);
        const $img = $(`<img class="pw-avatar-strip-img ${isSelected ? 'selected' : ''}" data-avatar-id="${item.id}" src="${item.base64}" title="${item.name || ''}">`);
        $strip.append($img);
    });
}

function renderAvatarMgmt() {
    const $list = $('#pw-avatar-mgmt-grid');
    if (!$list.length) return;
    $list.empty();
    if (store.avatarImagesCache.length === 0) {
        $list.html('<div style="font-size:0.8em; opacity:0.4; padding:8px; text-align:center;">暂无上传图片</div>');
        return;
    }
    store.avatarImagesCache.forEach(img => {
        const hasUser = img.tags && img.tags.includes('user');
        const hasNpc = img.tags && img.tags.includes('npc');
        const $item = $(`
            <div class="pw-avatar-card" data-img-id="${img.id}">
                <div class="pw-avatar-card-top">
                    <img src="${img.base64}" class="pw-avatar-card-img">
                    <span class="pw-avatar-card-del" title="删除"><i class="fa-solid fa-xmark"></i></span>
                </div>
                <span class="pw-avatar-card-name" title="点击编辑名称">${img.name || '未命名'}</span>
                <div class="pw-avatar-card-tags">
                    <span class="pw-avatar-tag ${hasUser ? 'active' : ''}" data-tag="user">User</span>
                    <span class="pw-avatar-tag ${hasNpc ? 'active' : ''}" data-tag="npc">NPC</span>
                </div>
            </div>
        `);
        $list.append($item);
    });
}

async function openCreatorPopup() {
    const context = getContext();
    loadData();

    // Pre-load current user avatar in background
    fetchAvatarAsBase64().then(b64 => {
        store.currentUserAvatarBase64 = b64;
        if ($('#pw-avatar-strip').length) renderAvatarStrip();
    });

    const savedState = loadState();
    let localConfig = savedState.localConfig || {};

    // --- [新增] API 多配置迁移与初始化 ---
    if (!localConfig.apiProfiles) {
        localConfig.apiProfiles =[];
        // 如果存在旧版独立API记录，自动将其存为“默认配置”
        const existingUrl = localConfig.indepApiUrl || defaultSettings.indepApiUrl;
        if (existingUrl) {
            localConfig.apiProfiles.push({
                id: Date.now().toString(),
                name: "默认配置 1",
                url: existingUrl,
                key: localConfig.indepApiKey || defaultSettings.indepApiKey || "",
                model: localConfig.indepApiModel || defaultSettings.indepApiModel || ""
            });
            localConfig.activeApiProfileId = localConfig.apiProfiles[0].id;
        }
        savedState.localConfig = localConfig;
        saveState(savedState); // 保存迁移后的结构
    }
    // -------------------------------------

    const config = { ...defaultSettings, ...savedState.localConfig };

    let currentName = $('.persona_name').first().text().trim();
    if (!currentName) currentName = $('h5#your_name').text().trim();
    if (!currentName) currentName = context.powerUserSettings?.persona_selected || "User";

    const isNpc = store.uiStateCache.generationMode === 'npc';
    const chatHistEnabled = store.uiStateCache.chatHistory && store.uiStateCache.chatHistory.enabled;
    const activeData = isNpc ? store.npcContext : store.userContext;
    
    const charName = getContext().characters[getContext().characterId]?.name || "None";
    
    const headerTitle = `${TEXT.PANEL_TITLE}<span class="pw-header-subtitle">User:${currentName} & Char:${charName}</span>`;

    const chipsDisplay = store.uiStateCache.templateExpanded ? 'flex' : 'none';
    const chipsIcon = store.uiStateCache.templateExpanded ? 'fa-angle-up' : 'fa-angle-down';

    // [Fix 10] Generate Preset Options
    let presetOptionsHtml = `
        <option value="current" ${store.uiStateCache.generationPreset === 'current' ? 'selected' : ''}>跟随酒馆预设 (Default)</option>
        <option value="pure" ${store.uiStateCache.generationPreset === 'pure' ? 'selected' : ''}>✨ 纯净模式 (Pure Mode)</option>
    `;
    if (window.TavernHelper && typeof window.TavernHelper.getPresetNames === 'function') {
        const presets = window.TavernHelper.getPresetNames().sort();
        presets.forEach(p => {
            if (p !== 'in_use') {
                const sel = store.uiStateCache.generationPreset === p ? 'selected' : '';
                presetOptionsHtml += `<option value="${p}" ${sel}>[预设] ${p}</option>`;
            }
        });
    }

    // [Fix 14] Initial Hint Text
    const initialHint = getPresetHintText(store.uiStateCache.generationPreset);

    let initialProfileName = "默认配置 1";
    if (localConfig.apiProfiles && localConfig.apiProfiles.length > 0) {
        const activeProf = localConfig.apiProfiles.find(p => p.id === localConfig.activeApiProfileId);
        if (activeProf) initialProfileName = activeProf.name;
    } else if (localConfig.activeApiProfileId === 'custom') {
        initialProfileName = "";
    }

    const html = `
<div class="pw-wrapper">
    <div class="pw-header">
        <div class="pw-top-bar"><div class="pw-title">${headerTitle}</div></div>
        <div class="pw-tabs">
            <div class="pw-tab active" data-tab="editor">人设</div>
            <div class="pw-tab" data-tab="context">参考</div> 
            <div class="pw-tab" data-tab="api">API</div>
            <div class="pw-tab" data-tab="history">记录</div>
        </div>
    </div>

    <!-- Editor View -->
    <div id="pw-view-editor" class="pw-view active">
        <div class="pw-scroll-area">
            <!-- Mode Switcher -->
            <div class="pw-info-display mode-switcher">
                <div class="pw-mode-toggle-group">
                    <div class="pw-mode-item ${!isNpc ? 'active' : ''}" data-mode="user" title="User 模式">
                        <i class="fa-solid fa-user"></i> ${currentName}
                    </div>
                    <div class="pw-mode-item ${isNpc ? 'active' : ''}" data-mode="npc" title="NPC 模式">
                        <i class="fa-solid fa-user-secret"></i> NPC
                    </div>
                </div>
                <div class="pw-load-btn" id="pw-btn-load-current">载入已有人设</div>
            </div>

            <div>
                <div class="pw-tags-header">
                    <span class="pw-tags-label" id="pw-template-block-header" style="cursor:pointer; user-select:none;">
                        模版块 (点击填入) 
                        <i class="fa-solid ${chipsIcon}" style="margin-left:5px;" title="折叠/展开"></i>
                    </span>
                    <div class="pw-tags-actions">
                        <span class="pw-tags-edit-toggle" id="pw-load-main-template" style="${isNpc ? '' : 'display:none;'} margin-right:10px;">使用User模版</span>
                        <span class="pw-tags-edit-toggle" id="pw-toggle-edit-template">编辑模版</span>
                    </div>
                </div>
                <div class="pw-tags-container" id="pw-template-chips" style="display:${chipsDisplay};"></div>
                
                <div class="pw-template-editor-area" id="pw-template-editor">
                    <div class="pw-template-toolbar">
                        <div class="pw-shortcut-bar">
                            <div class="pw-shortcut-btn" data-key="  "><span>缩进</span><span class="code">Tab</span></div>
                            <div class="pw-shortcut-btn" data-key=": "><span>冒号</span><span class="code">:</span></div>
                            <div class="pw-shortcut-btn" data-key="- "><span>列表</span><span class="code">-</span></div>
                            <div class="pw-shortcut-btn" data-key="\n"><span>换行</span><span class="code">Enter</span></div>
                        </div>
                        <div class="pw-mini-btn" id="pw-reset-template-small" title="恢复为该模式的默认模版" style="margin-left:auto; padding:2px 8px; font-size:0.8em; border:none; background:transparent; opacity:0.6;"><i class="fa-solid fa-rotate-left"></i></div>
                    </div>
                    <textarea id="pw-template-text" class="pw-template-textarea">${activeData.template}</textarea>
                    <div class="pw-template-footer">
                        <button class="pw-mini-btn" id="pw-save-template">保存模版</button>
                    </div>
                </div>
            </div>

            <div class="pw-context-row ${(store.uiStateCache.avatarRef.selectedIds || []).length > 0 ? 'active' : ''}" id="pw-avatar-ref-row">
                <span class="pw-context-row-label">形象参考<span id="pw-avatar-count-badge" class="pw-context-badge ${(store.uiStateCache.avatarRef.selectedIds || []).length > 0 ? 'visible' : ''}">${(store.uiStateCache.avatarRef.selectedIds || []).length || ''}</span></span>
                <div id="pw-avatar-strip" class="pw-avatar-strip"></div>
                <span id="pw-avatar-add-btn" class="pw-avatar-add-btn" title="管理头像"><i class="fa-solid fa-plus"></i></span>
            </div>

            <div class="pw-context-row ${chatHistEnabled ? 'active' : ''}" id="pw-chat-infer-row">
                <input type="checkbox" id="pw-chat-infer-main-toggle" ${chatHistEnabled ? 'checked' : ''} style="display:none;">
                <span class="pw-context-row-label pw-chat-toggle-zone" style="cursor:pointer;">聊天记录注入</span>
                <span class="pw-context-row-right pw-chat-settings-zone">
                    <span id="pw-chat-infer-summary" class="pw-context-row-hint">${chatHistEnabled ? (store.uiStateCache.chatHistory.preset === 'all' ? '全部' : '最近' + (store.uiStateCache.chatHistory.preset || '10') + '条') : '未启用'}</span>
                    <span id="pw-chat-token-badge" class="pw-chat-token-badge" style="display:none;"></span>
                </span>
            </div>

            <textarea id="pw-request" class="pw-textarea pw-auto-height" placeholder="在此输入要求，或点击上方模版块插入参考结构（无需全部填满）...">${activeData.request}</textarea>
            <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid ${chatHistEnabled ? 'fa-comments' : 'fa-wand-magic-sparkles'}"></i> ${chatHistEnabled ? '聊天推断生成' : (isNpc ? '生成 NPC 设定' : '生成 User 设定')}</button>

            <div id="pw-result-area" style="display:${activeData.hasResult ? 'block' : 'none'}; margin-top:15px;">
                <div class="pw-relative-container">
                    <textarea id="pw-result-text" class="pw-result-textarea pw-auto-height" placeholder="生成的结果将显示在这里..." style="min-height: 200px;">${activeData.result}</textarea>
                </div>
                
                <div class="pw-refine-toolbar">
                    <textarea id="pw-refine-input" class="pw-refine-input" placeholder="${chatHistEnabled ? '输入更新方向，或留空直接基于聊天记录更新...' : '输入意见，或选中上方文字后点击浮窗快速修改...'}"></textarea>
                    <div class="pw-refine-btn-vertical" id="pw-btn-refine" title="${chatHistEnabled ? '基于聊天记录更新人设' : '执行润色'}">
                        <span class="pw-refine-btn-text">${chatHistEnabled ? '更新' : '润色'}</span>
                        <i class="fa-solid ${chatHistEnabled ? 'fa-rotate' : 'fa-magic'}"></i>
                    </div>
                </div>
                <button class="pw-btn gen" id="pw-btn-apply-template" style="display:none; margin-top:8px; width:100%;"><i class="fa-solid fa-file-import"></i> 应用到模版</button>
            </div>
        </div>

        <div class="pw-footer">
            <div class="pw-footer-group">
                <div class="pw-compact-btn danger" id="pw-clear" title="清空"><i class="fa-solid fa-eraser"></i></div>
                <div class="pw-compact-btn" id="pw-copy-persona" title="复制内容"><i class="fa-solid fa-copy"></i></div>
                <div class="pw-compact-btn" id="pw-snapshot" title="保存至记录"><i class="fa-solid fa-save"></i></div>
            </div>
            <div class="pw-footer-group" style="flex:1; justify-content:flex-end; gap: 8px;">
                <button class="pw-btn wi" id="pw-btn-save-wi">保存至世界书</button>
                <button class="pw-btn save" id="pw-btn-apply" style="${isNpc ? 'display:none;' : ''}">覆盖当前人设</button>
            </div>
        </div>
    </div>

    <!-- Diff Overlay -->
    <div id="pw-diff-overlay" class="pw-diff-container" style="display:none;">
        <div class="pw-diff-toolbar">
            <span id="pw-diff-hint" class="pw-diff-hint-inline"><i class="fa-solid fa-circle-info"></i> 点击高亮文字切换版本</span>
            <div style="flex:1;"></div>
            <button class="pw-diff-mode-btn" data-mode="old"><i class="fa-solid fa-file-lines"></i> 原版</button>
            <button class="pw-diff-mode-btn" data-mode="new"><i class="fa-solid fa-file-circle-plus"></i> 新版</button>
            <button class="pw-diff-mode-btn" data-mode="final"><i class="fa-solid fa-eye"></i> 最终</button>
        </div>
        
        <div class="pw-diff-content-area">
            <div id="pw-diff-merge-view" class="pw-diff-merge-view">
                <div id="pw-diff-merge-list" class="pw-diff-mode-all"></div>
            </div>
        </div>

        <div class="pw-diff-actions">
            <button class="pw-btn primary" id="pw-diff-reroll" title="使用相同的提示词重新生成"><i class="fa-solid fa-rotate-right"></i> 重新生成</button>
            <div style="flex:1;"></div>
            <button class="pw-btn danger" id="pw-diff-cancel"><i class="fa-solid fa-xmark"></i> 放弃</button>
            <button class="pw-btn gen" id="pw-diff-confirm" style="width:auto;"><i class="fa-solid fa-check"></i> 应用</button>
        </div>
    </div>

    <!-- Load Persona Overlay -->
    <div id="pw-load-overlay" class="pw-load-overlay-backdrop">
        <div class="pw-load-overlay-card">
            <div class="pw-load-overlay-header">
                <span id="pw-load-overlay-title">载入已有人设</span>
                <button class="pw-btn danger" id="pw-load-overlay-close" style="padding:4px 10px;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="pw-load-overlay-content" class="pw-load-overlay-body"></div>
        </div>
    </div>

    <div id="pw-float-quote-btn" class="pw-float-quote-btn"><i class="fa-solid fa-pen-to-square"></i> 修改此段</div>

    <!-- Context View -->
    <div id="pw-view-context" class="pw-view">
        <div class="pw-scroll-area">
            
            <!-- [Fix 13] Preset Selector Relocated to TOP & Styled simply -->
            <div class="pw-card-section">
                <div class="pw-row">
                    <label class="pw-section-label">生成预设</label>
                    <select id="pw-preset-select" class="pw-input" style="flex:1; width:100%;">
                        ${presetOptionsHtml}
                    </select>
                </div>
                <div id="pw-preset-hint" style="font-size:0.8em; opacity:0.7; margin-top:4px; margin-left: 5px; color: var(--SmartThemeBodyColor);">
                    ${initialHint}
                </div>
            </div>

            <div class="pw-card-section">
                <div class="pw-row">
                    <label class="pw-section-label pw-label-gold">角色开场白</label>
                    <select id="pw-greetings-select" class="pw-input" style="flex:1; width:100%;">
                        <option value="">(不使用开场白)</option>
                    </select>
                </div>
                <!-- [Fix 1] Restored original textarea with larger height -->
                <div id="pw-greetings-toggle-bar" class="pw-preview-toggle-bar" style="display:none;">
                    <i class="fa-solid fa-angle-up"></i> 收起预览
                </div>
                <textarea id="pw-greetings-preview" style="display:none; min-height: 300px; margin-top:5px;"></textarea>
            </div>

            <div class="pw-card-section">
                <div class="pw-row" style="margin-bottom:5px;">
                    <label class="pw-section-label pw-label-blue">世界书</label>
                </div>
                <div id="pw-wi-body" style="display:block; padding-top:5px;">
                    <div class="pw-wi-controls" style="margin-bottom:8px;">
                        <select id="pw-wi-select" class="pw-input pw-wi-select"><option value="">正在加载...</option></select>
                        <button id="pw-wi-add" class="pw-btn primary pw-wi-add-btn"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div id="pw-wi-container"></div>
                </div>
            </div>

            <div class="pw-card-section" id="pw-avatar-mgmt-section">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                    <label class="pw-section-label pw-avatar-mgmt-toggle" style="flex:1; min-width:0; text-align:left; cursor:pointer;">形象参考 <i class="fa-solid fa-chevron-down" style="font-size:0.7em; opacity:0.5; margin-left:2px;"></i></label>
                    <label class="pw-mini-btn" style="cursor:pointer; display:inline-flex; align-items:center; gap:3px; padding:2px 8px; font-size:0.75em; white-space:nowrap; flex-shrink:0;">
                        <i class="fa-solid fa-upload"></i> 上传
                        <input type="file" id="pw-avatar-upload" accept="image/*" multiple style="display:none;">
                    </label>
                </div>
                <div id="pw-avatar-mgmt-body" class="pw-avatar-mgmt-body" style="display:none;">
                    <div id="pw-avatar-mgmt-grid" class="pw-avatar-mgmt-grid"></div>
                </div>
            </div>

            <div class="pw-card-section" id="pw-chat-history-section">
                <div class="pw-row" style="margin-bottom:5px;">
                    <label class="pw-section-label">聊天记录设置</label>
                    <span style="font-size:0.72em; opacity:0.5;">在主页面点击启用</span>
                </div>
                <div id="pw-chat-history-body" style="display:flex; padding-top:5px; flex-direction:column; gap:8px;">
                    <div class="pw-row" style="gap:6px; flex-wrap:nowrap; justify-content:flex-start;">
                        <label style="font-size:0.85em; white-space:nowrap; opacity:0.8;">消息范围</label>
                        <select id="pw-chat-preset" class="pw-input" style="flex:0 0 auto; width:auto; padding:4px 6px; font-size:0.85em;">
                            <option value="10">最近 10 条</option>
                            <option value="20" selected>最近 20 条</option>
                            <option value="50">最近 50 条</option>
                            <option value="all">全部</option>
                            <option value="custom">自定义层数</option>
                        </select>
                        <div id="pw-chat-custom-range" style="display:none; flex:0 0 auto; align-items:center; gap:4px;">
                            <input type="number" id="pw-chat-floor-from" class="pw-input" placeholder="从" style="width:55px; padding:4px; text-align:center; font-size:0.85em;">
                            <span style="opacity:0.6;">-</span>
                            <input type="number" id="pw-chat-floor-to" class="pw-input" placeholder="到" style="width:55px; padding:4px; text-align:center; font-size:0.85em;">
                        </div>
                        <span id="pw-chat-range-label" style="font-size:0.75em; opacity:0.6; white-space:nowrap;"></span>
                    </div>

                    <div class="pw-chat-filter-section">
                        <div class="pw-chat-filter-header" id="pw-chat-filter-toggle">
                            <span style="font-size:0.85em; opacity:0.8;"><i class="fa-solid fa-tags"></i> 标签过滤 (char回复)</span>
                            <i class="fa-solid fa-chevron-down pw-chat-filter-arrow" style="transition:0.2s; font-size:0.75em; opacity:0.5;"></i>
                        </div>
                        <div id="pw-chat-filter-body" style="display:none;">
                            <div style="display:flex; gap:4px; align-items:center;">
                                <input type="text" id="pw-chat-tag-input" class="pw-input" placeholder="输入标签名回车" style="flex:1; padding:4px 6px; font-size:0.85em;">
                                <button class="pw-btn primary" id="pw-chat-scan-tags" style="padding:4px 8px; font-size:0.8em;"><i class="fa-solid fa-wand-magic-sparkles"></i> 扫描</button>
                            </div>
                            <div id="pw-chat-scan-results" style="display:none; flex-wrap:wrap; gap:4px; padding:4px; background:rgba(0,0,0,0.03); border-radius:4px;"></div>
                            <div style="font-size:0.7em; opacity:0.6; color:#d68b1c;">点击标签切换: 保留/排除。User发言始终全部保留。</div>
                            <div id="pw-chat-active-tags" style="display:flex; flex-wrap:wrap; gap:4px;"></div>
                        </div>
                    </div>

                    <div style="display:flex; gap:6px;">
                        <button class="pw-btn primary" id="pw-chat-preview-btn" style="flex:1; padding:5px; font-size:0.85em;"><i class="fa-solid fa-eye"></i> 预览抓取内容</button>
                        <button class="pw-btn" id="pw-chat-refresh-btn" style="padding:5px 8px; font-size:0.85em;" title="刷新token估算"><i class="fa-solid fa-rotate-right"></i></button>
                    </div>
                    <div id="pw-chat-preview-area" style="display:none; max-height:400px; overflow-y:auto; padding:8px; background:var(--pw-paper-bg); border:1px solid var(--pw-border); border-radius:6px; font-size:0.8em; white-space:pre-wrap; line-height:1.5; text-align:left; color:var(--pw-text-main);"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- API View (Only Connection) -->
    <div id="pw-view-api" class="pw-view">
        <div class="pw-scroll-area">
            <div class="pw-card-section">
                <div class="pw-row"><label>API 来源</label><select id="pw-api-source" class="pw-input" style="flex:1;"><option value="main" ${config.apiSource === 'main' ? 'selected' : ''}>主 API</option><option value="independent" ${config.apiSource === 'independent' ? 'selected' : ''}>独立 API</option></select></div>
                <div id="pw-indep-settings" style="display:${config.apiSource === 'independent' ? 'flex' : 'none'}; flex-direction:column; gap:15px; margin-top:8px;">
                    
                    <!-- 选择预设 -->
                    <div class="pw-row" style="padding-bottom: 12px; border-bottom: 1px dashed var(--SmartThemeBorderColor);">
                        <label>配置预设</label>
                        <div style="flex:1; display:flex; gap:5px; width:100%; min-width: 0;">
                            <select id="pw-api-profile-select" class="pw-select" style="flex:1;"></select>
                            <button id="pw-api-profile-add" class="pw-btn primary" title="新建空白配置" style="width:auto; padding: 6px 10px;"><i class="fa-solid fa-plus"></i></button>
                            <button id="pw-api-profile-delete" class="pw-btn danger" title="删除当前配置" style="width:auto; padding: 6px 10px;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>

                    <!-- 配置编辑表单 -->
                    <div class="pw-row"><label>配置命名</label><input type="text" id="pw-api-profile-name" class="pw-input" value="${initialProfileName}" style="flex:1;" placeholder="例如: OpenAI, Claude..."></div>
                    <div class="pw-row"><label>URL</label><input type="text" id="pw-api-url" class="pw-input" value="${config.indepApiUrl}" style="flex:1;" placeholder="http://.../v1"></div>
                    <div class="pw-row"><label>Key</label><input type="password" id="pw-api-key" class="pw-input" value="${config.indepApiKey}" style="flex:1;"></div>
                    <div class="pw-row"><label>Model</label>
                        <div style="flex:1; display:flex; gap:5px; width:100%; min-width: 0;">
                            <select id="pw-api-model-select" class="pw-select" style="flex:1;"><option value="${config.indepApiModel}">${config.indepApiModel}</option></select>
                            <button id="pw-api-fetch" class="pw-btn primary pw-api-fetch-btn" title="刷新模型列表" style="width:auto;"><i class="fa-solid fa-sync"></i></button>
                            <button id="pw-api-test" class="pw-btn primary" style="width:auto;" title="测试连接"><i class="fa-solid fa-plug"></i></button>
                        </div>
                    </div>
                    <div class="pw-row">
                        <label title="单次请求最长等待时间。Claude / 第三方中转站输出长 YAML 常需 2~5 分钟，默认 300 秒。超时后会提示而不再静默失败。">请求超时 (秒)</label>
                        <input type="number" id="pw-indep-timeout" class="pw-input" min="30" max="1800" step="10"
                            value="${Number(config.indepTimeout) > 0 ? Number(config.indepTimeout) : 300}"
                            style="flex:1;" placeholder="300">
                    </div>
                    <div class="pw-row">
                        <label title="开启后以 SSE 流式方式接收响应，避免 Cloudflare / 酒馆后端 / 中转站在等待完整响应时返回 504 Gateway Timeout。此开关同时作用于独立 API 和主 API。">流式输出</label>
                        <div style="flex:1; display:flex; align-items:center; gap:8px;">
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="pw-indep-stream" ${config.indepStream !== false ? 'checked' : ''}>
                                <span style="opacity:0.85;">启用 (推荐，避免 504)</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- History View with Pagination -->
    <div id="pw-view-history" class="pw-view">
        <div class="pw-scroll-area">
            <!-- Detailed History Types -->
            <div class="pw-history-filters" style="display:flex; gap:5px; margin-bottom:8px;">
                <select id="pw-hist-filter-type" class="pw-input" style="flex:1;">
                    <option value="all">所有类型</option>
                    <option value="user_persona">User人设</option>
                    <option value="npc_persona">NPC人设</option>
                    <option value="user_template">User模板</option>
                    <option value="npc_template">NPC模板</option>
                </select>
                <select id="pw-hist-filter-char" class="pw-input" style="flex:1;">
                    <option value="all">所有角色</option>
                    <!-- Populated via JS -->
                </select>
            </div>

            <div class="pw-search-box">
                <i class="fa-solid fa-search pw-search-icon"></i>
                <input type="text" id="pw-history-search" class="pw-input pw-search-input" placeholder="搜索历史...">
                <i class="fa-solid fa-times pw-search-clear" id="pw-history-search-clear" title="清空搜索"></i>
            </div>
            
            <div id="pw-history-list" style="display:flex; flex-direction:column;"></div>
            
            <div class="pw-pagination">
                <button class="pw-page-btn" id="pw-hist-prev"><i class="fa-solid fa-chevron-left"></i></button>
                <span class="pw-page-info" id="pw-hist-page-info">1 / 1</span>
                <button class="pw-page-btn" id="pw-hist-next"><i class="fa-solid fa-chevron-right"></i></button>
            </div>

            <button id="pw-history-clear-all" class="pw-btn" style="margin-top:15px;">清空所有记录</button>
        </div>
    </div>
</div>
`;

    callPopup(html, 'text', '', { wide: true, large: true, okButton: "Close" });

    renderTemplateChips();
    loadAvailableWorldBooks().then(() => {
        renderWiBooks();
        const options = store.availableWorldBooks.length > 0 ? store.availableWorldBooks.map(b => `<option value="${b}">${b}</option>`).join('') : `<option disabled>未找到世界书</option>`;
        $('#pw-wi-select').html(`<option value="">-- 添加参考/目标世界书 --</option>${options}`);
    });

    renderGreetingsList();
    autoBindGreetings();
    renderApiProfiles();

    $('.pw-auto-height').each(function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    if (activeData.hasResult) {
        $('#pw-request').addClass('minimized');
    }

    // Restore chat history UI state
    const chatConf = store.uiStateCache.chatHistory || {};
    if (chatConf.preset) $('#pw-chat-preset').val(chatConf.preset);
    if (chatConf.preset === 'custom') $('#pw-chat-custom-range').css('display', 'flex');
    if (chatConf.floorFrom) $('#pw-chat-floor-from').val(chatConf.floorFrom);
    if (chatConf.floorTo) $('#pw-chat-floor-to').val(chatConf.floorTo);
    if (chatConf.enabled) {
        $('#pw-chat-infer-main-toggle').prop('checked', true).trigger('change');
    }
}

// ============================================================================
// 5. 事件绑定
// ============================================================================
function bindEvents() {
    if (window.stPersonaWeaverBound) return;
    window.stPersonaWeaverBound = true;

    console.log("[PW] Binding Events (Standard)...");

    const context = getContext();
    if (context && context.eventSource) {
        context.eventSource.on(context.eventTypes.APP_READY, addPersonaButton);
        context.eventSource.on(context.eventTypes.MOVABLE_PANELS_RESET, addPersonaButton);
    }
    window.openPersonaWeaver = openCreatorPopup;
// --- [新增] API 预设表单管理事件 ---
    
    // 1. 新建配置 (生成空白档并自动选中)
    $(document).on('click.pw', '#pw-api-profile-add', function(e) {
        e.preventDefault();
        
        const savedState = loadState();
        let lc = savedState.localConfig || {};
        if (!lc.apiProfiles) lc.apiProfiles =[];
        
        const newId = Date.now().toString();
        const newName = "新配置 " + (lc.apiProfiles.length + 1);
        
        lc.apiProfiles.push({
            id: newId,
            name: newName,
            url: '',
            key: '',
            model: ''
        });
        lc.activeApiProfileId = newId;
        savedState.localConfig = lc;
        saveState(savedState);
        
        // 刷新列表并清空表单
        renderApiProfiles();
        $('#pw-api-profile-name').val(newName);
        $('#pw-api-url').val('').focus(); // 自动聚焦 URL 框方便输入
        $('#pw-api-key').val('');
        $('#pw-api-model-select').empty().append('<option value="">请填写URL和Key后获取</option>');
        
        toastr.success("已创建空白配置，修改将自动保存");
    });

    // 2. 切换配置
    $(document).on('change.pw', '#pw-api-profile-select', function() {
        const activeId = $(this).val();
        const savedState = loadState();
        let lc = savedState.localConfig || {};

        if (activeId === 'custom') {
            lc.activeApiProfileId = 'custom';
            $('#pw-api-profile-name').val('');
            savedState.localConfig = lc;
            saveState(savedState);
            return;
        }

        if (lc.apiProfiles) {
            const prof = lc.apiProfiles.find(p => p.id === activeId);
            if (prof) {
                $('#pw-api-profile-name').val(prof.name);
                $('#pw-api-url').val(prof.url);
                $('#pw-api-key').val(prof.key);
                
                if ($('#pw-api-model-select option[value="'+prof.model+'"]').length === 0 && prof.model) {
                    $('#pw-api-model-select').append(`<option value="${prof.model}">${prof.model}</option>`);
                }
                $('#pw-api-model-select').val(prof.model);

                lc.activeApiProfileId = activeId;
                lc.indepApiUrl = prof.url;
                lc.indepApiKey = prof.key;
                lc.indepApiModel = prof.model;
                savedState.localConfig = lc;
                saveState(savedState);
            }
        }
    });

    // 3. 删除配置
    $(document).on('click.pw', '#pw-api-profile-delete', function(e) {
        e.preventDefault();
        const activeId = $('#pw-api-profile-select').val();
        if (!activeId || activeId === 'custom') return toastr.warning("请先选择一个已保存的配置");
        if (!confirm("确定要删除当前选中的 API 配置吗？")) return;

        const savedState = loadState();
        let lc = savedState.localConfig || {};
        if (lc.apiProfiles) {
            lc.apiProfiles = lc.apiProfiles.filter(p => p.id !== activeId);
            lc.activeApiProfileId = lc.apiProfiles.length > 0 ? lc.apiProfiles[0].id : 'custom';
            savedState.localConfig = lc;
            saveState(savedState);
            
            renderApiProfiles();
            $('#pw-api-profile-select').trigger('change.pw'); 
            toastr.success("已删除配置");
        }
    });

    // --- Mode Switcher (Pill Style - Isolated Data) ---
    $(document).on('click.pw', '.pw-mode-item', function() {
        const mode = $(this).data('mode');
        if (mode === store.uiStateCache.generationMode) return;
        
        // 1. Save current data to context object
        const curReq = $('#pw-request').val();
        const curRes = $('#pw-result-text').val();
        const curTmpl = $('#pw-template-text').val();
        const hasRes = $('#pw-result-area').is(':visible');

        if (store.uiStateCache.generationMode === 'npc') {
            store.npcContext = { template: curTmpl, request: curReq, result: curRes, hasResult: hasRes };
        } else {
            store.userContext = { template: curTmpl, request: curReq, result: curRes, hasResult: hasRes };
        }
        
        // 2. Switch Mode
        $('.pw-mode-item').removeClass('active');
        $(this).addClass('active');
        store.uiStateCache.generationMode = mode;
        saveData();

        // 3. Load target data
        const targetData = mode === 'npc' ? store.npcContext : store.userContext;
        $('#pw-request').val(targetData.request);
        $('#pw-result-text').val(targetData.result);
        $('#pw-template-text').val(targetData.template);
        
        if (targetData.hasResult) {
            $('#pw-result-area').show();
            $('#pw-request').addClass('minimized');
        } else {
            $('#pw-result-area').hide();
            $('#pw-request').removeClass('minimized');
        }

        renderTemplateChips();

        // Reset template editing state on mode switch
        if (store.isEditingTemplate) {
            store.isEditingTemplate = false;
            $('#pw-template-editor').hide();
            $('#pw-template-chips').css('display', 'flex');
            $('#pw-toggle-edit-template').text("编辑模版").removeClass('editing');
            $('#pw-template-block-header').find('i').show();
            $('#pw-btn-apply-template').hide();
        }
        $('#pw-request').attr('placeholder', '在此输入要求，或点击上方模版块插入参考结构（无需全部填满）...');

        // 4. Update UI Buttons
        if (mode === 'npc') {
            $('#pw-btn-apply').hide();
            $('#pw-load-main-template').show();
            toastr.info("已切换至 NPC 模式");
        } else {
            $('#pw-btn-apply').show();
            $('#pw-load-main-template').hide();
            toastr.info("已切换至 User 模式");
        }
        updateChatInferBadge();
        renderAvatarStrip();
    });

    // [Fix 10] Preset Select Change Logic
    $(document).on('change.pw', '#pw-preset-select', function() {
        const val = $(this).val();
        store.uiStateCache.generationPreset = val;
        saveData();
        // [Fix 14] Update Hint on Change
        $('#pw-preset-hint').text(getPresetHintText(val));
    });

    $(document).on('click.pw', '#pw-hist-prev', () => { if (store.historyPage > 1) { store.historyPage--; renderHistoryList(); } });
    $(document).on('click.pw', '#pw-hist-next', () => { store.historyPage++; renderHistoryList(); });

    $(document).on('change.pw', '#pw-hist-filter-type, #pw-hist-filter-char', function() {
        store.historyPage = 1;
        renderHistoryList();
    });

    $(document).on('change.pw', '#pw-greetings-select', function() {
        const idx = $(this).val();
        const $preview = $('#pw-greetings-preview');
        const $toggleBtn = $('#pw-greetings-toggle-bar');
        
        if (idx === "") {
            $preview.slideUp(200);
            $toggleBtn.hide();
        } else if (store.currentGreetingsList[idx]) {
            $preview.val(store.currentGreetingsList[idx].content);
            $preview.slideDown(200); // Slide direct
            $toggleBtn.show().html('<i class="fa-solid fa-angle-up"></i> 收起预览');
        }
    });

    // [Fix 1] Greetings Toggle - Fixed JS for direct textarea
    $(document).on('click.pw', '#pw-greetings-toggle-bar', function() {
        const $preview = $('#pw-greetings-preview');
        if ($preview.is(':visible')) {
            $preview.slideUp(200);
            $(this).html('<i class="fa-solid fa-angle-down"></i> 展开预览');
        } else {
            $preview.slideDown(200);
            $(this).html('<i class="fa-solid fa-angle-up"></i> 收起预览');
        }
    });

    $(document).on('click.pw', '#pw-copy-persona', function() {
        const text = $('#pw-result-text').val();
        if(!text) return toastr.warning("没有内容可复制");
        navigator.clipboard.writeText(text);
        toastr.success("人设已复制");
    });

    $(document).on('click.pw', '.pw-tab', function () {
        $('.pw-tab').removeClass('active'); $(this).addClass('active');
        $('.pw-view').removeClass('active');
        $(`#pw-view-${$(this).data('tab')}`).addClass('active');
        if ($(this).data('tab') === 'history') {
            store.historyPage = 1; // Reset to page 1
            renderHistoryList();
        }
    });

    $(document).on('click.pw', '#pw-toggle-edit-template', () => {
        store.isEditingTemplate = !store.isEditingTemplate;
        const tmpl = getCurrentTemplate();
        const isNpc = store.uiStateCache.generationMode === 'npc';
        
        if (store.isEditingTemplate) {
            $('#pw-template-text').val(tmpl);
            $('#pw-template-chips').hide();
            $('#pw-template-editor').css('display', 'flex');
            $('#pw-toggle-edit-template').text("取消编辑").addClass('editing');
            $('#pw-template-block-header').find('i').hide();
            $('#pw-request').attr('placeholder', '输入模版需求，如：添加修仙相关属性、简化外貌字段...');
            $('#pw-btn-gen').html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成模版');
            $('#pw-btn-apply-template').show();
            $('#pw-avatar-ref-row, #pw-chat-infer-row').slideUp(200);
        } else {
            $('#pw-template-editor').hide();
            $('#pw-template-chips').css('display', 'flex');
            $('#pw-toggle-edit-template').text("编辑模版").removeClass('editing');
            $('#pw-template-block-header').find('i').show();
            $('#pw-request').attr('placeholder', '在此输入要求，或点击上方模版块插入参考结构（无需全部填满）...');
            $('#pw-btn-gen').html(`<i class="fa-solid fa-wand-magic-sparkles"></i> ${isNpc ? '生成 NPC 设定' : '生成 User 设定'}`);
            $('#pw-btn-apply-template').hide();
            $('#pw-avatar-ref-row, #pw-chat-infer-row').slideDown(200);
        }
    });

    $(document).on('click.pw', '#pw-template-block-header', function() {
        if (store.isEditingTemplate) return; 
        const $chips = $('#pw-template-chips');
        const $icon = $(this).find('i');
        if ($chips.is(':visible')) {
            $chips.slideUp();
            $icon.removeClass('fa-angle-up').addClass('fa-angle-down');
            store.uiStateCache.templateExpanded = false;
        } else {
            $chips.slideDown().css('display', 'flex');
            $icon.removeClass('fa-angle-down').addClass('fa-angle-up');
            store.uiStateCache.templateExpanded = true;
        }
        saveData(); 
    });

    // Load Main Template logic
    $(document).on('click.pw', '#pw-load-main-template', function() {
        if(confirm("确定要使用默认的 User 主模版吗？这将覆盖当前编辑器内容。")) {
            $('#pw-template-text').val(DEFAULT_TEMPLATES.user);
            if (store.uiStateCache.generationMode === 'npc') store.npcContext.template = DEFAULT_TEMPLATES.user;
            else store.userContext.template = DEFAULT_TEMPLATES.user;
            saveData();
            if(!store.isEditingTemplate) renderTemplateChips();
            toastr.success("已载入 User 主模版");
        }
    });

    // Reset Template Small Button
    $(document).on('click.pw', '#pw-reset-template-small', function() {
        const isNpc = store.uiStateCache.generationMode === 'npc';
        const targetName = isNpc ? "NPC" : "User";
        if(confirm(`确定要恢复为默认的 ${targetName} 模版吗？`)) {
            const fallbackT = isNpc ? DEFAULT_TEMPLATES.npc : DEFAULT_TEMPLATES.user;
            $('#pw-template-text').val(fallbackT);
            if (isNpc) store.npcContext.template = fallbackT;
            else store.userContext.template = fallbackT;
            saveData();
            if(!store.isEditingTemplate) renderTemplateChips();
            toastr.success(`已恢复默认 ${targetName} 模版`);
        }
    });

    // (旧的 #pw-gen-template-smart 已移除，模板生成统一走 #pw-btn-gen)
    $(document).on('click.pw', '#pw-gen-template-smart-DISABLED', async function() {
        if (store.isProcessing) return;
        store.isProcessing = true;
        const $btn = $(this);
        const originalText = $btn.html();
        $btn.html('<i class="fas fa-spinner fa-spin"></i> 生成中...');
        
        try {
            const contextData = await collectContextData();
            const charInfoText = getCharacterInfoText(); 
            const hasCharInfo = charInfoText && charInfoText.length > 50; 
            const hasWi = contextData.wi && contextData.wi.length > 10;

            if (!hasCharInfo && !hasWi) {
                const wantGeneric = confirm("当前未检测到关联的角色卡或世界书信息。\n\n是否要生成通用模版？");
                
                if (!wantGeneric) {
                    store.isProcessing = false;
                    $btn.html(originalText);
                    return;
                }

                const useDefault = confirm("请选择模版来源：\n\n点击【确定】使用内置默认模版（推荐）\n点击【取消】生成全新的通用模版");

                if (useDefault) {
                    const isNpc = store.uiStateCache.generationMode === 'npc';
                    const fallbackT = isNpc ? DEFAULT_TEMPLATES.npc : DEFAULT_TEMPLATES.user;
                    
                    $('#pw-template-text').val(fallbackT);
                    if (isNpc) store.npcContext.template = fallbackT;
                    else store.userContext.template = fallbackT;
                    saveData();
                    renderTemplateChips();
                    toastr.success(`已恢复默认${isNpc ? 'NPC' : 'User'}模板`);
                    
                    store.isProcessing = false;
                    $btn.html(originalText);
                    return; 
                }
            }

            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                wiText: contextData.wi,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            
            const generatedTemplate = await runGeneration(config, config, true);
            
            if (generatedTemplate) {
                $('#pw-template-text').val(generatedTemplate);
                
                if (store.uiStateCache.generationMode === 'npc') store.npcContext.template = generatedTemplate;
                else store.userContext.template = generatedTemplate;
                saveData();

                renderTemplateChips();
                
                if (!store.isEditingTemplate) {
                    $('#pw-toggle-edit-template').click();
                }
                toastr.success("模版生成成功！请点击“保存模版”确认修改。");
            }
        } catch (e) {
            console.error(e);
            toastr.error("模版生成失败: " + e.message);
        } finally {
            $btn.html(originalText);
            store.isProcessing = false;
        }
    });

    $(document).on('click.pw', '#pw-save-template', () => {
        const val = $('#pw-template-text').val();
        
        if (store.uiStateCache.generationMode === 'npc') store.npcContext.template = val;
        else store.userContext.template = val;
        saveData();
        
        saveHistory({ 
            request: "模版手动保存", 
            timestamp: new Date().toLocaleString(), 
            title: "", 
            data: { 
                resultText: val, 
                type: 'template'
            } 
        });

        renderTemplateChips();
        store.isEditingTemplate = false;
        $('#pw-template-editor').hide();
        $('#pw-template-chips').css('display', 'flex');
        $('#pw-toggle-edit-template').text("编辑模版").removeClass('editing');
        $('#pw-template-block-header').find('i').show();
        $('#pw-btn-apply-template').hide();
        const isNpc = store.uiStateCache.generationMode === 'npc';
        $('#pw-request').attr('placeholder', '在此输入要求，或点击上方模版块插入参考结构（无需全部填满）...');
        $('#pw-btn-gen').html(`<i class="fa-solid fa-wand-magic-sparkles"></i> ${isNpc ? '生成 NPC 设定' : '生成 User 设定'}`);
        toastr.success("模版已更新并保存至记录");
    });

    // Apply result to template
    $(document).on('click.pw', '#pw-btn-apply-template', function() {
        const resultText = $('#pw-result-text').val();
        if (!resultText) {
            toastr.warning("结果区域为空，无内容可应用");
            return;
        }
        $('#pw-template-text').val(resultText);
        if (store.uiStateCache.generationMode === 'npc') store.npcContext.template = resultText;
        else store.userContext.template = resultText;
        saveData();
        renderTemplateChips();
        toastr.success("已将结果应用到模版编辑器，请确认后点击「保存模版」");
    });

    $(document).on('click.pw', '.pw-shortcut-btn', function () {
        const key = $(this).data('key');
        const $text = $('#pw-template-text');
        const el = $text[0];
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        const insertText = key === '\n' ? '\n' : key;
        el.value = val.substring(0, start) + insertText + val.substring(end);
        el.selectionStart = el.selectionEnd = start + insertText.length;
        el.focus();
    });

    let selectionTimeout;
    const checkSelection = () => {
        clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
            const activeEl = document.activeElement;
            if (!activeEl || !activeEl.id.startsWith('pw-result-text')) return;
            const hasSelection = activeEl.selectionStart !== activeEl.selectionEnd;
            const $btn = $('#pw-float-quote-btn');
            if (hasSelection) {
                if (!$btn.is(':visible')) $btn.stop(true, true).fadeIn(200).css('display', 'flex');
            } else {
                if ($btn.is(':visible')) $btn.stop(true, true).fadeOut(200);
            }
        }, 100);
    };
    $(document).on('touchend mouseup keyup', '#pw-result-text', checkSelection);

    $(document).on('mousedown.pw', '#pw-float-quote-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        const activeEl = document.activeElement;
        if (!activeEl) return;
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const selectedText = activeEl.value.substring(start, end).trim();
        if (selectedText) {
            let $input = $('#pw-refine-input');
            if ($input && $input.length) {
                const cur = $input.val();
                const newText = `对 "${selectedText}" 的修改意见为：`;
                $input.val(cur ? cur + '\n' + newText : newText).focus();
                activeEl.setSelectionRange(end, end); 
                $('#pw-float-quote-btn').fadeOut(100);
            }
        }
    });

    let _ahTimer = null;
    const adjustHeight = (el) => {
        if (_ahTimer) return;
        _ahTimer = requestAnimationFrame(() => {
            _ahTimer = null;
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight) + 'px';
        });
    };
    $(document).on('input.pw', '.pw-auto-height', function () { adjustHeight(this); });

    let saveTimeout;
    const saveCurrentState = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            // [Fix 2] CRITICAL: Guard Clause to prevent wiping on close
            if ($('#pw-request').length === 0) return;

            const curReq = $('#pw-request').val();
            const curRes = $('#pw-result-text').val();
            const hasRes = $('#pw-result-area').is(':visible');

            if (store.uiStateCache.generationMode === 'npc') {
                store.npcContext.request = curReq;
                store.npcContext.result = curRes;
                store.npcContext.hasResult = hasRes;
            } else {
                store.userContext.request = curReq;
                store.userContext.result = curRes;
                store.userContext.hasResult = hasRes;
            }

            saveData(); 
            
            // Check if API settings exist before saving legacy
            if ($('#pw-api-url').length > 0) {
                const currentSaved = loadState();
                let currentLc = currentSaved.localConfig || {};

                currentLc.apiSource = $('#pw-api-source').val();
                currentLc.indepApiUrl = $('#pw-api-url').val();
                currentLc.indepApiKey = $('#pw-api-key').val();
                currentLc.indepApiModel = $('#pw-api-model-select').val() || $('#pw-api-model').val();
                const timeoutInput = parseInt($('#pw-indep-timeout').val(), 10);
                if (timeoutInput > 0) currentLc.indepTimeout = Math.min(1800, Math.max(30, timeoutInput));
                const $streamEl = $('#pw-indep-stream');
                if ($streamEl.length) currentLc.indepStream = $streamEl.prop('checked');
                // max_tokens 现在由 resolveMaxTokens() 按模型名自动推断，不再有 UI 可配置
                currentLc.extraBooks = window.pwExtraBooks ||[];

                // --- 自动热保存至当前选中配置 ---
                const activeId = $('#pw-api-profile-select').val();
                const currentName = $('#pw-api-profile-name').val() || "未命名配置";
                
                if (activeId && activeId !== 'custom') {
                    if (!currentLc.apiProfiles) currentLc.apiProfiles =[];
                    const prof = currentLc.apiProfiles.find(p => p.id === activeId);
                    if (prof) {
                        prof.name = currentName;
                        prof.url = currentLc.indepApiUrl;
                        prof.key = currentLc.indepApiKey;
                        prof.model = currentLc.indepApiModel;
                        
                        $(`#pw-api-profile-select option[value="${activeId}"]`).text(currentName);
                    }
                    currentLc.activeApiProfileId = activeId;
                } else {
                    currentLc.activeApiProfileId = 'custom';
                }

                currentSaved.localConfig = currentLc;
                saveState(currentSaved);
            }
        }, 1200); 
    };           
    
    $(document).on('input.pw change.pw', '#pw-request, #pw-result-text, #pw-wi-toggle, #pw-indep-stream, .pw-input, .pw-select', saveCurrentState);

    // --- 文本框焦点切换：点击哪个展开哪个 ---
    $(document).on('focus.pw', '#pw-request', function() {
        if ($('#pw-result-area').is(':visible')) {
            $(this).removeClass('minimized');
            $('#pw-result-text').addClass('minimized');
            $('#pw-template-text').removeClass('expanded').addClass('minimized');
        }
    });
    $(document).on('focus.pw', '#pw-result-text', function() {
        if ($('#pw-result-area').is(':visible')) {
            $(this).removeClass('minimized');
            $('#pw-request').addClass('minimized');
            $('#pw-template-text').removeClass('expanded').addClass('minimized');
        }
    });

    $(document).on('focus.pw', '#pw-template-text', function() {
        $(this).removeClass('minimized').addClass('expanded');
        $('#pw-request').addClass('minimized');
        if ($('#pw-result-area').is(':visible')) {
            $('#pw-result-text').addClass('minimized');
        }
    });

    // --- Diff View Logic (Sub-view Mode Switching) ---
    $(document).on('click.pw', '.pw-diff-mode-btn', function () {
        const $list = $('#pw-diff-merge-list');
        if ($(this).hasClass('active')) {
            $(this).removeClass('active');
            $list.removeClass('pw-diff-mode-new pw-diff-mode-old pw-diff-mode-final').addClass('pw-diff-mode-all');
            $('#pw-diff-hint').show();
            return;
        }
        $('.pw-diff-mode-btn').removeClass('active');
        $(this).addClass('active');
        const mode = $(this).data('mode');
        $list.removeClass('pw-diff-mode-all pw-diff-mode-new pw-diff-mode-old pw-diff-mode-final').addClass('pw-diff-mode-' + mode);
        $('#pw-diff-hint').hide();
    });

    $(document).on('mousedown.pw', '.pw-idiff-old', function () {
        if (!$('#pw-diff-merge-list').hasClass('pw-diff-mode-all')) return;
        if ($(this).hasClass('active')) return;
        const idx = $(this).data('idx');
        store.currentDiffBlocks[idx].active = 'old';
        $(this).addClass('active').removeClass('inactive').attr('contenteditable', 'true');
        $(this).siblings('.pw-idiff-new').addClass('inactive').removeClass('active').attr('contenteditable', 'false');
    });
    $(document).on('mousedown.pw', '.pw-idiff-new', function () {
        if (!$('#pw-diff-merge-list').hasClass('pw-diff-mode-all')) return;
        if ($(this).hasClass('active')) return;
        const idx = $(this).data('idx');
        store.currentDiffBlocks[idx].active = 'new';
        $(this).addClass('active').removeClass('inactive').attr('contenteditable', 'true');
        $(this).siblings('.pw-idiff-old').addClass('inactive').removeClass('active').attr('contenteditable', 'false');
    });

    // 容器级 input：跨 span 编辑后统一回写到 store.currentDiffBlocks
    $(document).on('input.pw', '#pw-diff-merge-list', function () {
        $(this).find('.pw-idiff-equal').each(function () {
            const idx = $(this).data('idx');
            if (idx !== undefined && store.currentDiffBlocks[idx]) store.currentDiffBlocks[idx].value = $(this).text();
        });
        $(this).find('.pw-idiff-old.active').each(function () {
            const idx = $(this).data('idx');
            if (idx !== undefined && store.currentDiffBlocks[idx]) store.currentDiffBlocks[idx].oldText = $(this).text();
        });
        $(this).find('.pw-idiff-new.active').each(function () {
            const idx = $(this).data('idx');
            if (idx !== undefined && store.currentDiffBlocks[idx]) store.currentDiffBlocks[idx].newText = $(this).text();
        });
    });

    // Refine (Persona)
   // ================== 1. 润色按钮逻辑 (主界面) ==================
    $(document).on('click.pw', '#pw-btn-refine', async function (e) {
        e.preventDefault();
        if (store.isProcessing) return;
        store.isProcessing = true;

        const refineReq = $('#pw-refine-input').val();
        const chatInferOn = store.uiStateCache.chatHistory && store.uiStateCache.chatHistory.enabled && !store.isEditingTemplate;
        if (!refineReq && !chatInferOn) {
            toastr.warning("请输入润色意见");
            store.isProcessing = false;
            return;
        }
        
        store.lastRefineRequest = refineReq || (chatInferOn ? '[基于聊天记录更新]' : '');

        if(!store.promptsCache.personaGen) loadData();

        const oldText = $('#pw-result-text').val();
        const $btn = $(this).find('i').removeClass('fa-magic fa-rotate').addClass('fa-spinner fa-spin');
        
        await forcePaint();

        try {
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const isTemplateRefine = store.isEditingTemplate;
            const config = {
                mode: 'refine', 
                request: refineReq, 
                currentText: oldText, 
                wiText: contextData.wi,           
                greetingsText: isTemplateRefine ? '' : contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            const responseText = await runGeneration(config, config, isTemplateRefine);

            // 复用提取出来的渲染函数
            renderDiffComparison(oldText, responseText);

            $('#pw-diff-overlay').data('source', 'persona');

            $('#pw-diff-overlay').fadeIn();
            $('#pw-refine-input').val(''); // 清空输入框
        } catch (e) { 
            console.error(e);
            toastr.error((chatInferOn ? "更新" : "润色") + "失败: " + e.message); 
        } finally { 
            $btn.removeClass('fa-spinner fa-spin').addClass(chatInferOn ? 'fa-rotate' : 'fa-magic');
            store.isProcessing = false;
        }
    });

    // ================== 2. 重 Roll 按钮逻辑 (Diff界面内) ==================
    $(document).on('click.pw', '#pw-diff-reroll', async function (e) {
        e.preventDefault();
        if (store.isProcessing) return;
        if (!store.lastRefineRequest) {
            toastr.warning("未找到上一次的润色要求");
            return;
        }

        store.isProcessing = true;
        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 生成中...');

        // 只要没点确认保存，旧文本就一直是 result-text 里的内容
        const oldText = $('#pw-result-text').val(); 

        try {
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const isTemplateRefine = store.isEditingTemplate;
            const config = {
                mode: 'refine', 
                request: store.lastRefineRequest,
                currentText: oldText, 
                wiText: contextData.wi,           
                greetingsText: isTemplateRefine ? '' : contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            
            const responseText = await runGeneration(config, config, isTemplateRefine);

            // 复用渲染函数，原地刷新 Diff 界面
            renderDiffComparison(oldText, responseText);
            
            toastr.success("已重新生成并更新对比！");

        } catch (e) {
            console.error(e);
            toastr.error("重Roll失败: " + e.message);
        } finally {
            $btn.html(originalHtml);
            store.isProcessing = false;
        }
    });

    $(document).on('click.pw', '#pw-diff-confirm', function () {
        const finalContent = assembleDiffResult();
        $('#pw-result-text').val(finalContent).trigger('input');
        $('#pw-diff-overlay').fadeOut();
        saveCurrentState();
        toastr.success("修改已应用");
    });

    $(document).on('click.pw', '#pw-diff-cancel', () => $('#pw-diff-overlay').fadeOut());

    // Generate Persona / Template
    $(document).on('click.pw', '#pw-btn-gen', async function (e) {
        e.preventDefault();
        
        if (store.isProcessing) return;
        store.isProcessing = true;

        const isTemplateGen = store.isEditingTemplate;
        const chatInferOn = store.uiStateCache.chatHistory && store.uiStateCache.chatHistory.enabled && !isTemplateGen;
        console.log(`[PW] Gen Clicked (template=${isTemplateGen}, chatInfer=${chatInferOn})`);
        const req = $('#pw-request').val();
        if (!req && !isTemplateGen && !chatInferOn) {
            toastr.warning("请输入要求");
            store.isProcessing = false;
            return;
        }
        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 生成中...');
        
        await forcePaint();
        
        $('#pw-refine-input').val('');
        $('#pw-result-text').val('');

        try {
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const existingResult = chatInferOn ? ($('#pw-result-text').data('prev-result') || '') : '';
            const config = {
                mode: 'initial', 
                request: req || '',
                currentText: existingResult,
                wiText: contextData.wi,
                greetingsText: isTemplateGen ? '' : contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            const text = await runGeneration(config, config, isTemplateGen);
            $('#pw-result-text').val(text);
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
            if (isTemplateGen) {
                $('#pw-btn-apply-template').show();
            }
            saveCurrentState();
            $('#pw-result-text').trigger('input');
        } catch (e) { 
            console.error(e);
            toastr.error(e.message); 
        } finally { 
            const isNpc = store.uiStateCache.generationMode === 'npc';
            if (isTemplateGen) {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成模版');
            } else if (chatInferOn) {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-comments"></i> 聊天推断生成');
            } else {
                $btn.prop('disabled', false).html(isNpc ? '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 NPC 设定' : '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
            }
            store.isProcessing = false;
        }
    });

    $(document).on('click.pw', '#pw-load-overlay-close', () => $('#pw-load-overlay').animate({opacity: 0}, 200, function() { $(this).css('display', 'none'); }));

    $(document).on('click.pw', '#pw-btn-load-current', async function() {
        const isNpc = store.uiStateCache.generationMode === 'npc';
        const $overlay = $('#pw-load-overlay');
        const $content = $('#pw-load-overlay-content');

        const applyContent = (content) => {
            if (!content) return toastr.warning("未找到有效内容");
            if ($('#pw-result-text').val() && !confirm("当前结果框已有内容，确定要覆盖吗？")) return;
            $('#pw-result-text').val(content);
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
            $overlay.animate({opacity: 0}, 200, function() { $(this).css('display', 'none'); });
            toastr.success(TEXT.TOAST_LOAD_CURRENT);
            saveCurrentState();
            $('#pw-result-text').trigger('input');
        };

        const showWiSelector = async (filterKeyword) => {
            const boundBooks = await getContextWorldBooks();
            const allBooks = [...new Set([...boundBooks, ...(window.pwExtraBooks || [])])];
            if (allBooks.length === 0) return toastr.warning("未找到可用的世界书");

            let allEntries = [];
            for (const bookName of allBooks) {
                const entries = await getWorldBookEntries(bookName);
                entries.forEach(e => {
                    if (e.content) allEntries.push({ book: bookName, ...e });
                });
            }

            if (filterKeyword) {
                const kw = filterKeyword.toLowerCase();
                const filtered = allEntries.filter(e =>
                    (e.displayName || '').toLowerCase().includes(kw) ||
                    (e.content || '').toLowerCase().includes(kw)
                );
                if (filtered.length > 0) allEntries = filtered;
            }

            if (allEntries.length === 0) { $overlay.animate({opacity: 0}, 200, function() { $(this).css('display', 'none'); }); return toastr.warning("世界书中没有找到相关条目"); }

            const optionsHtml = allEntries.map((e, i) =>
                `<option value="${i}">[${e.book}] ${e.displayName}</option>`
            ).join('');

            $content.html(`
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <select id="pw-wi-load-select" class="pw-input" style="width:100%;">
                        ${optionsHtml}
                    </select>
                    <div id="pw-wi-load-preview" style="max-height:35vh; overflow-y:auto; padding:8px; background:var(--pw-paper-bg); border:1px solid var(--pw-border); border-radius:6px; font-size:0.85em; white-space:pre-wrap; line-height:1.5; text-align:left; color:var(--pw-text-main);"></div>
                    <button class="pw-btn gen" id="pw-wi-load-confirm" style="flex-shrink:0;"><i class="fa-solid fa-check"></i> 载入选中条目</button>
                </div>`);

            $('#pw-wi-load-select').on('change', function() {
                const idx = parseInt($(this).val());
                if (!isNaN(idx) && allEntries[idx]) {
                    $('#pw-wi-load-preview').text(allEntries[idx].content);
                }
            }).val('0').trigger('change');

            $('#pw-wi-load-confirm').on('click', function() {
                const idx = parseInt($('#pw-wi-load-select').val());
                if (!isNaN(idx) && allEntries[idx]) {
                    applyContent(allEntries[idx].content);
                }
            });
        };

        if (isNpc) {
            $('#pw-load-overlay-title').text('载入世界书 NPC 人设');
            $content.html('<div style="text-align:center; padding:20px; opacity:0.6;"><i class="fas fa-spinner fa-spin"></i> 正在读取世界书...</div>');
            $overlay.css('display', 'flex').css('opacity', 0).animate({opacity: 1}, 200);
            const charName = getContext().characters[getContext().characterId]?.name || '';
            await showWiSelector(charName);
        } else {
            const userPersona = getActivePersonaDescription();
            const hasUserPersona = !!userPersona;

            $('#pw-load-overlay-title').text('载入已有人设');
            $content.html(`
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <span style="opacity:0.7; font-size:0.9em;">选择载入来源</span>
                    <div style="display:flex; gap:8px; width:100%;">
                        <button class="pw-btn primary pw-load-choice" data-choice="user" style="flex:1; padding:10px; font-size:0.95em;${!hasUserPersona ? ' opacity:0.4; cursor:not-allowed;' : ''}" ${!hasUserPersona ? 'disabled title="未检测到当前 User 人设"' : ''}>
                            <i class="fa-solid fa-user"></i> User 人设
                        </button>
                        <button class="pw-btn primary pw-load-choice" data-choice="worldbook" style="flex:1; padding:10px; font-size:0.95em;">
                            <i class="fa-solid fa-book-atlas"></i> 世界书条目
                        </button>
                    </div>
                </div>`);

            $overlay.css('display', 'flex').css('opacity', 0).animate({opacity: 1}, 200);

            $content.find('.pw-load-choice').on('click', async function() {
                const choice = $(this).data('choice');
                if (choice === 'user') {
                    applyContent(userPersona);
                } else {
                    $content.html('<div style="text-align:center; padding:20px; opacity:0.6;"><i class="fas fa-spinner fa-spin"></i> 正在读取世界书...</div>');
                    const userName = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || '';
                    await showWiSelector(userName);
                }
            });
        }
    });

    $(document).on('click.pw', '#pw-btn-save-wi', async function () {
        const content = $('#pw-result-text').val();
        if (!content) return toastr.warning("内容为空，无法保存");
        const name = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";
        await syncToWorldInfoViaHelper(name, content);
    });

    $(document).on('click.pw', '#pw-btn-apply', async function () {
        const content = $('#pw-result-text').val();
        if (!content) return toastr.warning("内容为空");
        const name = $('.persona_name').first().text().trim() || $('h5#your_name').text().trim() || "User";
        await forceSavePersona(name, content);
        toastr.success(TEXT.TOAST_SAVE_SUCCESS(name));
        $('.popup_close').click();
    });

    $(document).on('click.pw', '#pw-clear', function () {
        if (confirm("确定清空？")) {
            $('#pw-request').val('').removeClass('minimized');
            $('#pw-result-area').hide();
            $('#pw-result-text').val('');
            saveCurrentState();
        }
    });

    $(document).on('click.pw', '#pw-snapshot', function () {
        const text = $('#pw-result-text').val();
        const req = $('#pw-request').val();
        if (!text && !req) return toastr.warning("没有任何内容可保存");
        saveHistory({ 
            request: req || "无", 
            timestamp: new Date().toLocaleString(), 
            title: "", 
            data: { 
                name: "Persona", 
                resultText: text || "(无)", 
                type: 'persona'
            } 
        });
        toastr.success(TEXT.TOAST_SNAPSHOT);
    });

    // [Fix 1] History Edit Fix: Stop Propagation
    $(document).on('click.pw', '.pw-hist-action-btn.edit', function (e) {
        e.stopPropagation();
        const $header = $(this).closest('.pw-hist-header');
        const $display = $header.find('.pw-hist-title-display');
        const $input = $header.find('.pw-hist-title-input');
        $display.hide(); $input.show().focus();
        
        const saveEdit = (ev) => {
            if (ev) ev.stopPropagation(); // Stop bubble
            const newVal = $input.val();
            $display.text(newVal).show(); $input.hide();
            const index = $header.closest('.pw-history-item').find('.pw-hist-action-btn.del').data('index');
            if (store.historyCache[index]) { store.historyCache[index].title = newVal; saveData(); }
            $(document).off('click.pw-hist-blur');
        };
        
        $input.on('click', function(ev) { ev.stopPropagation(); });

        $input.one('blur keyup', function (ev) { 
            if (ev.type === 'keyup') {
                if (ev.key === 'Enter') saveEdit(ev);
                return;
            }
            saveEdit(ev); 
        });
    });

    $(document).on('change.pw', '#pw-api-source', function () { $('#pw-indep-settings').toggle($(this).val() === 'independent'); });

    $(document).on('click.pw', '#pw-api-fetch', async function (e) {
        e.preventDefault();
        const url = $('#pw-api-url').val().replace(/\/$/, '');
        const key = $('#pw-api-key').val();
        const $btn = $(this).find('i').addClass('fa-spin');
        const isAnthropicStyle = url.toLowerCase().includes('anthropic.com') || url.includes('/v1/messages');
        try {
            let data = null;
            if (isAnthropicStyle) {
                let base = url.replace(/\/v1\/messages$/, '').replace(/\/v1$/, '').replace(/\/$/, '');
                const anthEp = `${base}/v1/models`;
                try {
                    const res = await fetch(anthEp, {
                        method: 'GET',
                        headers: {
                            'x-api-key': key,
                            'anthropic-version': '2023-06-01'
                        }
                    });
                    if (res.ok) data = await res.json();
                } catch { }
            }
            if (!data) {
                // 规范化：支持 https://x/ , https://x/v1 , https://x/v1/chat/completions 等写法
                const cleanBase = url.replace(/\/chat\/completions$/, '');
                const endpoints = [
                    /\/v\d+$/.test(cleanBase) ? `${cleanBase}/models` : `${cleanBase}/v1/models`,
                    `${cleanBase}/models`
                ];
                for (const ep of endpoints) {
                    try {
                        const res = await fetch(ep, { method: 'GET', headers: { 'Authorization': `Bearer ${key}` } });
                        if (res.ok) { data = await res.json(); break; }
                    } catch { }
                }
            }
            if (!data) throw new Error("连接失败或无法获取模型列表");
            const rawList = data.data || data;
            const models = (Array.isArray(rawList) ? rawList : []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort();
            const $select = $('#pw-api-model-select').empty();
            models.forEach(m => $select.append(`<option value="${m}">${m}</option>`));
            if (models.length > 0) $select.val(models[0]);
            toastr.success(`获取到 ${models.length} 个模型`);
        } catch (e) { toastr.error(e.message); }
        finally { $btn.removeClass('fa-spin'); }
    });

    $(document).on('click.pw', '#pw-api-test', async function (e) {
        e.preventDefault();
        const url = $('#pw-api-url').val().replace(/\/$/, '');
        const key = $('#pw-api-key').val();
        const model = $('#pw-api-model-select').val();
        const $btn = $(this).html('<i class="fas fa-spinner fa-spin"></i>');
        const isAnthropicStyle = url.toLowerCase().includes('anthropic.com') || url.includes('/v1/messages');
        try {
            if (isAnthropicStyle) {
                let base = url.replace(/\/v1\/messages$/, '').replace(/\/v1$/, '').replace(/\/$/, '');
                const ep = `${base}/v1/messages`;
                const res = await fetch(ep, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                        model: model || 'claude-3-5-haiku-20241022',
                        max_tokens: 16,
                        messages: [{ role: 'user', content: 'Hi' }]
                    })
                });
                if (res.ok) toastr.success("连接成功！");
                else toastr.error(`失败: ${res.status}`);
            } else {
                const cleanBase = url.replace(/\/chat\/completions$/, '');
                const ep = /\/v\d+$/.test(cleanBase) ? `${cleanBase}/chat/completions` : `${cleanBase}/v1/chat/completions`;
                const res = await fetch(ep, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                    body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 })
                });
                if (res.ok) toastr.success("连接成功！");
                else toastr.error(`失败: ${res.status}`);
            }
        } catch (e) { toastr.error("请求发送失败"); }
        finally { $btn.html('<i class="fa-solid fa-plug"></i>'); }
    });

    $(document).on('click.pw', '#pw-wi-add', () => { const val = $('#pw-wi-select').val(); if (val && !window.pwExtraBooks.includes(val)) { window.pwExtraBooks.push(val); renderWiBooks(); } });

    // === Chat History Reference Events ===
    const refreshChatTokenEstimate = async () => {
        if (!store.uiStateCache.chatHistory.enabled) { $('#pw-chat-token-badge').hide(); return; }
        const result = await fetchChatHistoryFiltered();
        const tokens = result.tokenEstimate;
        const $badge = $('#pw-chat-token-badge');
        if (tokens > 8000) {
            $badge.text(`~${tokens} tokens`).css({background: 'rgba(255,80,80,0.2)', color: '#ff6b6b', border: '1px solid rgba(255,80,80,0.4)'}).attr('title', '警告: token 数量较大，可能影响生成质量或超出上下文限制').show();
        } else if (tokens > 4000) {
            $badge.text(`~${tokens} tokens`).css({background: 'rgba(240,173,78,0.15)', color: '#d68b1c', border: '1px solid rgba(240,173,78,0.3)'}).attr('title', '注意: token 数量较多').show();
        } else {
            $badge.text(`~${tokens} tokens`).css({background: 'rgba(92,184,92,0.1)', color: '#5cb85c', border: '1px solid rgba(92,184,92,0.3)'}).attr('title', '').show();
        }
        const msgs = result.messages;
        if (msgs.length > 0) {
            const first = msgs[0].floorId, last = msgs[msgs.length - 1].floorId;
            $('#pw-chat-range-label').text(`(#${first} - #${last})`);
        }
    };

    $(document).on('change.pw', '#pw-chat-infer-main-toggle', function () {
        const enabled = $(this).prop('checked');
        store.uiStateCache.chatHistory.enabled = enabled;
        $('#pw-chat-infer-row').toggleClass('active', enabled);
        if (enabled) {
            if (!store.uiStateCache.chatHistory.preset) store.uiStateCache.chatHistory.preset = '10';
            refreshChatTokenEstimate();
            renderChatTags();
        } else {
            $('#pw-chat-token-badge').hide();
            $('#pw-chat-range-label').text('');
        }
        updateChatInferSummary();
        saveCurrentState();
        updateChatInferBadge();
    });

    $(document).on('click.pw', '#pw-chat-infer-row .pw-chat-settings-zone', function (e) {
        e.stopPropagation();
        const enabled = $('#pw-chat-infer-main-toggle').prop('checked');
        if (enabled) {
            $('.pw-tab[data-tab="context"]').click();
            setTimeout(() => {
                const $section = $('#pw-chat-history-section');
                if ($section.length) $section[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);
        } else {
            const $cb = $('#pw-chat-infer-main-toggle');
            $cb.prop('checked', true).trigger('change');
        }
    });

    $(document).on('click.pw', '#pw-chat-infer-row', function (e) {
        if ($(e.target).closest('.pw-chat-settings-zone').length) return;
        const $cb = $('#pw-chat-infer-main-toggle');
        $cb.prop('checked', !$cb.prop('checked')).trigger('change');
    });

    // === Avatar Reference System ===

    $(document).on('click.pw', '.pw-avatar-strip-img', function () {
        const id = $(this).data('avatar-id');
        if (!store.uiStateCache.avatarRef.selectedIds) store.uiStateCache.avatarRef.selectedIds = [];
        const sel = store.uiStateCache.avatarRef.selectedIds;
        const idx = sel.indexOf(id);
        if (idx >= 0) { sel.splice(idx, 1); $(this).removeClass('selected'); }
        else { sel.push(id); $(this).addClass('selected'); }
        $('#pw-avatar-ref-row').toggleClass('active', sel.length > 0);
        const $badge = $('#pw-avatar-count-badge');
        if (sel.length > 0) { $badge.text(sel.length).addClass('visible'); }
        else { $badge.removeClass('visible'); }
        saveCurrentState();
    });

    $(document).on('change.pw', '#pw-avatar-upload', async function () {
        const files = this.files;
        if (!files || files.length === 0) return;
        let addedCount = 0;
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            try {
                const rawBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const base64 = await compressImage(rawBase64, 512, 0.7);
                store.avatarImagesCache.push({
                    id: generateId(),
                    name: file.name.replace(/\.[^.]+$/, ''),
                    base64: base64,
                    tags: ['user', 'npc'],
                    addedAt: Date.now()
                });
                addedCount++;
            } catch (e) { console.warn("[PW] Failed to read image:", e); }
        }
        saveAvatarImages();
        renderAvatarMgmt();
        renderAvatarStrip();
        toastr.success(`已添加 ${addedCount} 张图片（已压缩）`);
        $(this).val('');
    });

    $(document).on('click.pw', '.pw-avatar-tag', function () {
        const $card = $(this).closest('.pw-avatar-card');
        const imgId = $card.data('img-id');
        const tag = $(this).data('tag');
        const img = store.avatarImagesCache.find(i => i.id === imgId);
        if (!img) return;
        if (!img.tags) img.tags = [];
        const idx = img.tags.indexOf(tag);
        if (idx >= 0) { img.tags.splice(idx, 1); $(this).removeClass('active'); }
        else { img.tags.push(tag); $(this).addClass('active'); }
        saveAvatarImages();
        renderAvatarStrip();
    });

    $(document).on('click.pw', '.pw-avatar-card-del', function () {
        const $card = $(this).closest('.pw-avatar-card');
        const imgId = $card.data('img-id');
        const idx = store.avatarImagesCache.findIndex(i => i.id === imgId);
        if (idx >= 0) {
            store.avatarImagesCache.splice(idx, 1);
            store.uiStateCache.avatarRef.selectedIds = (store.uiStateCache.avatarRef.selectedIds || []).filter(id => id !== imgId);
            saveAvatarImages();
            saveCurrentState();
            $card.fadeOut(200, () => { $card.remove(); renderAvatarStrip(); });
        }
    });

    $(document).on('click.pw', '.pw-avatar-card-name', function () {
        const $card = $(this).closest('.pw-avatar-card');
        const imgId = $card.data('img-id');
        const img = store.avatarImagesCache.find(i => i.id === imgId);
        if (!img) return;
        const currentName = img.name || '';
        const $input = $('<input type="text" class="pw-input">').val(currentName).css({ fontSize: '0.78em', padding: '2px 4px', width: '100%', textAlign: 'center' });
        $(this).replaceWith($input);
        $input.focus().select();
        const save = () => {
            const newName = $input.val().trim() || '未命名';
            img.name = newName;
            saveAvatarImages();
            const $newName = $('<span class="pw-avatar-card-name" title="点击编辑名称"></span>').text(newName);
            $input.replaceWith($newName);
        };
        $input.on('blur', save).on('keydown', function(ev) { if (ev.key === 'Enter') save(); });
    });

    $(document).on('click.pw', '.pw-avatar-mgmt-toggle', function () {
        const $body = $('#pw-avatar-mgmt-body');
        const $icon = $(this).find('i').last();
        $body.stop(true, true);
        if ($body.is(':visible')) {
            $body.slideUp(200);
            $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            renderAvatarMgmt();
            $body.slideDown(200);
            $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
        }
    });

    $(document).on('click.pw', '#pw-avatar-add-btn', function () {
        $('.pw-tab[data-tab="context"]').click();
        setTimeout(() => {
            const $section = $('#pw-avatar-mgmt-section');
            if ($section.length) $section[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
    });

    renderAvatarMgmt();
    renderAvatarStrip();

    function updateChatInferSummary() {
        const conf = store.uiStateCache.chatHistory || {};
        const enabled = conf.enabled;
        const preset = conf.preset || '10';
        let text = '未启用';
        if (enabled) {
            if (preset === 'custom' && conf.floorFrom && conf.floorTo) {
                text = `#${conf.floorFrom}-#${conf.floorTo}`;
            } else if (preset === 'all') {
                text = '全部消息';
            } else {
                text = `最近${preset}条`;
            }
        }
        $('#pw-chat-infer-summary').text(text);
    }

    $(document).on('change.pw', '#pw-chat-preset', function () {
        const val = $(this).val();
        store.uiStateCache.chatHistory.preset = val;
        $('#pw-chat-custom-range').css('display', val === 'custom' ? 'flex' : 'none');
        if (val !== 'custom') { store.uiStateCache.chatHistory.floorFrom = ''; store.uiStateCache.chatHistory.floorTo = ''; }
        refreshChatTokenEstimate();
        updateChatInferBadge();
        updateChatInferSummary();
        saveCurrentState();
    });

    $(document).on('change.pw', '#pw-chat-floor-from, #pw-chat-floor-to', function () {
        store.uiStateCache.chatHistory.floorFrom = $('#pw-chat-floor-from').val();
        store.uiStateCache.chatHistory.floorTo = $('#pw-chat-floor-to').val();
        refreshChatTokenEstimate();
        updateChatInferSummary();
        saveCurrentState();
    });

    let chatFilterExpanded = false;
    $(document).on('click.pw', '#pw-chat-filter-toggle', function () {
        chatFilterExpanded = !chatFilterExpanded;
        const $body = $('#pw-chat-filter-body');
        if (chatFilterExpanded) { $body.slideDown(150); }
        else { $body.slideUp(150); }
        $(this).find('.pw-chat-filter-arrow').css('transform', chatFilterExpanded ? 'rotate(180deg)' : 'rotate(0)');
    });

    const renderChatTags = () => {
        const $area = $('#pw-chat-active-tags').empty();
        const conf = store.uiStateCache.chatHistory;
        const allTags = [...(conf.excludeTags || []).map(t => ({name: t, mode: 'exclude'})), ...(conf.includeTags || []).map(t => ({name: t, mode: 'include'}))];
        allTags.forEach(t => {
            const cls = t.mode === 'include' ? 'pw-chat-tag-include' : 'pw-chat-tag-exclude';
            const icon = t.mode === 'include' ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-ban"></i>';
            const $chip = $(`<div class="pw-chat-tag-chip ${cls}"><span class="pw-chat-tag-text">${icon} ${t.name}</span><span class="pw-chat-tag-del"><i class="fa-solid fa-times"></i></span></div>`);
            $chip.find('.pw-chat-tag-text').on('click', function () {
                if (t.mode === 'exclude') {
                    conf.excludeTags = conf.excludeTags.filter(x => x !== t.name);
                    if (!conf.includeTags.includes(t.name)) conf.includeTags.push(t.name);
                } else {
                    conf.includeTags = conf.includeTags.filter(x => x !== t.name);
                    if (!conf.excludeTags.includes(t.name)) conf.excludeTags.push(t.name);
                }
                saveCurrentState(); renderChatTags(); refreshChatTokenEstimate();
            });
            $chip.find('.pw-chat-tag-del').on('click', function (e) {
                e.stopPropagation();
                conf.excludeTags = conf.excludeTags.filter(x => x !== t.name);
                conf.includeTags = conf.includeTags.filter(x => x !== t.name);
                saveCurrentState(); renderChatTags(); refreshChatTokenEstimate();
            });
            $area.append($chip);
        });
    };

    $(document).on('keypress.pw', '#pw-chat-tag-input', function (e) {
        if (e.which !== 13) return;
        const val = $(this).val().trim();
        if (!val) return;
        const conf = store.uiStateCache.chatHistory;
        if (!conf.excludeTags.includes(val) && !conf.includeTags.includes(val)) {
            conf.excludeTags.push(val);
            saveCurrentState(); renderChatTags(); refreshChatTokenEstimate();
        }
        $(this).val('');
    });

    $(document).on('click.pw', '#pw-chat-scan-tags', async function () {
        const tags = await scanChatTags(30);
        const $res = $('#pw-chat-scan-results').empty().css('display', 'flex');
        if (tags.length === 0) { $res.append('<span style="font-size:0.8em; opacity:0.6;">未检测到闭合标签</span>'); return; }
        tags.forEach(({tag, count}) => {
            const conf = store.uiStateCache.chatHistory;
            if (conf.excludeTags.includes(tag) || conf.includeTags.includes(tag)) return;
            const $c = $(`<div class="pw-chat-tag-chip" style="cursor:pointer; opacity:0.7;">${tag} (${count})</div>`);
            $c.on('click', function () {
                conf.excludeTags.push(tag);
                saveCurrentState(); renderChatTags(); refreshChatTokenEstimate();
                $(this).fadeOut(200);
            });
            $res.append($c);
        });
    });

    $(document).on('click.pw', '#pw-chat-preview-btn', async function () {
        const $preview = $('#pw-chat-preview-area');
        if ($preview.is(':visible')) { $preview.slideUp(150); $(this).html('<i class="fa-solid fa-eye"></i> 预览抓取内容'); return; }
        $(this).html('<i class="fa-solid fa-spinner fa-spin"></i> 加载中...');
        const result = await fetchChatHistoryFiltered();
        if (result.messages.length === 0) {
            $preview.text('未获取到聊天消息。请确认当前有活跃的聊天。').slideDown(150);
        } else {
            $preview.text(result.text).slideDown(150);
        }
        $(this).html('<i class="fa-solid fa-eye-slash"></i> 收起预览');
        refreshChatTokenEstimate();
    });

    $(document).on('click.pw', '#pw-chat-refresh-btn', refreshChatTokenEstimate);

    function updateChatInferBadge() {
        const enabled = store.uiStateCache.chatHistory && store.uiStateCache.chatHistory.enabled;
        const isNpc = store.uiStateCache.generationMode === 'npc';
        const $btn = $('#pw-btn-gen');
        const $refineBtn = $('#pw-btn-refine');
        const $refineInput = $('#pw-refine-input');
        if (enabled) {
            if (!store.isEditingTemplate) $btn.html('<i class="fa-solid fa-comments"></i> 聊天推断生成');
            $refineBtn.find('.pw-refine-btn-text').text('更新');
            $refineBtn.find('i').removeClass('fa-magic').addClass('fa-rotate');
            $refineBtn.attr('title', '基于聊天记录更新人设');
            $refineInput.attr('placeholder', '输入更新方向，或留空直接基于聊天记录更新...');
        } else {
            if (!store.isEditingTemplate) $btn.html(isNpc ? '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 NPC 设定' : '<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
            $refineBtn.find('.pw-refine-btn-text').text('润色');
            $refineBtn.find('i').removeClass('fa-rotate').addClass('fa-magic');
            $refineBtn.attr('title', '执行润色');
            $refineInput.attr('placeholder', '输入意见，或选中上方文字后点击浮窗快速修改...');
        }
    }

    $(document).on('input.pw', '#pw-history-search', function() { store.historyPage = 1; renderHistoryList(); });
    $(document).on('click.pw', '#pw-history-search-clear', function () { $('#pw-history-search').val('').trigger('input'); });
    $(document).on('click.pw', '#pw-history-clear-all', function () { if (confirm("清空?")) { store.historyCache = []; saveData(); renderHistoryList(); } });
}

const renderTemplateChips = () => {
    const $container = $('#pw-template-chips').empty();
    const blocks = parseYamlToBlocks(getCurrentTemplate());
    blocks.forEach((content, key) => {
        const $chip = $(`<div class="pw-tag-chip"><i class="fa-solid fa-cube" style="opacity:0.5; margin-right:4px;"></i><span>${key}</span></div>`);
        $chip.on('click', () => {
            const $text = $('#pw-request');
            const cur = $text.val();
            const prefix = (cur && !cur.endsWith('\n') && cur.length > 0) ? '\n\n' : '';
            let insertText = key + ":";
            if (content && content.trim()) {
                if (content.includes('\n') || content.startsWith(' ')) insertText += "\n" + content;
                else insertText += " " + content;
            } else insertText += " ";
            $text.val(cur + prefix + insertText).focus();
            $text.scrollTop($text[0].scrollHeight);
        });
        $container.append($chip);
    });
};

// [Fix 7] History Filter Logic Update
const renderHistoryList = () => {
    loadData();
    const $list = $('#pw-history-list').empty();
    
    const $filterChar = $('#pw-hist-filter-char');
    const currentCharFilter = $filterChar.val();
    
    const chars = new Set();
    store.historyCache.forEach(item => {
        const title = item.title || "";
        // [Fix 3] New title format parsing
        // NPC: "NPC：Name @ Char"
        // User: "User & Char" or "User模版 (Char)"
        let charName = "";
        if (title.includes(' @ ')) {
            const parts = title.split(' @ ');
            if (parts.length > 1) charName = parts[1].trim();
        } else if (title.includes(' (')) {
            const parts = title.split(' (');
            charName = parts[parts.length - 1].replace(')', '').trim();
        } else if (title.includes('&')) {
            const parts = title.split('&');
            if (parts.length > 1) charName = parts[1].trim();
        }
        
        if(charName) chars.add(charName);
    });
    
    if ($filterChar.children().length <= 1) {
        Array.from(chars).sort().forEach(c => $filterChar.append(`<option value="${c}">${c}</option>`));
        $filterChar.val(currentCharFilter || 'all');
    }

    const filterType = $('#pw-hist-filter-type').val();
    const filterChar = $('#pw-hist-filter-char').val();
    const search = $('#pw-history-search').val().toLowerCase();
    
    let filtered = store.historyCache.filter(item => {
        if (item.data && item.data.type === 'opening') return false; 
        
        // Accurate Type Filtering
        const type = item.data.genType || item.data.type;
        if (filterType !== 'all') {
            if (filterType === 'user_persona' && type !== 'user_persona' && type !== 'persona') return false;
            if (filterType === 'npc_persona' && type !== 'npc_persona' && type !== 'npc') return false;
            if (filterType === 'user_template' && type !== 'user_template' && type !== 'template') return false;
            if (filterType === 'npc_template' && type !== 'npc_template') return false;
        }

        if (filterChar !== 'all') {
            if (!item.title.includes(filterChar)) return false;
        }

        if (!search) return true;
        const content = (item.data.resultText || "").toLowerCase();
        const title = (item.title || "").toLowerCase();
        return title.includes(search) || content.includes(search);
    });
    
    const totalPages = Math.ceil(filtered.length / HISTORY_PER_PAGE) || 1;
    if (store.historyPage > totalPages) store.historyPage = totalPages;
    $('#pw-hist-page-info').text(`${store.historyPage} / ${totalPages}`);
    $('#pw-hist-prev').prop('disabled', store.historyPage <= 1);
    $('#pw-hist-next').prop('disabled', store.historyPage >= totalPages);

    const start = (store.historyPage - 1) * HISTORY_PER_PAGE;
    const paginated = filtered.slice(start, start + HISTORY_PER_PAGE);

    if (paginated.length === 0) { $list.html('<div style="text-align:center; opacity:0.6; padding:20px;">暂无记录</div>'); return; }

    paginated.forEach((item, index) => {
        const previewText = item.data.resultText || '无内容';
        const displayTitle = item.title || "User & Char";
        const type = item.data.genType || item.data.type;

        let badgeHtml = '';
        if (type === 'npc_template') {
            badgeHtml = '<span class="pw-badge template" style="background:rgba(255, 165, 0, 0.2); color:#ffbc42;">模版(N)</span>';
        } else if (type === 'user_template' || type === 'template') {
            badgeHtml = '<span class="pw-badge template">模版(U)</span>';
        } else if (type === 'npc_persona' || type === 'npc') {
            badgeHtml = '<span class="pw-badge npc" style="background:rgba(155, 89, 182, 0.2); color:#a569bd; border:1px solid rgba(155, 89, 182, 0.4);">NPC</span>';
        } else {
            badgeHtml = '<span class="pw-badge persona">User</span>';
        }

        const $el = $(`
        <div class="pw-history-item">
            <div class="pw-hist-main">
                <div class="pw-hist-header">
                    <span class="pw-hist-title-display">${badgeHtml} ${displayTitle}</span>
                    <input type="text" class="pw-hist-title-input" value="${displayTitle}" style="display:none;">
                    <div style="display:flex; gap:5px; flex-shrink:0;">
                        <i class="fa-solid fa-pen pw-hist-action-btn edit" title="编辑标题"></i>
                        <i class="fa-solid fa-trash pw-hist-action-btn del" data-index="${index}" title="删除"></i>
                    </div>
                </div>
                <div class="pw-hist-meta"><span>${item.timestamp || ''}</span></div>
                <div class="pw-hist-desc">${previewText}</div>
            </div>
        </div>
    `);
        $el.on('click', function (e) {
            if ($(e.target).closest('.pw-hist-action-btn, .pw-hist-title-input').length) return;
            
            // Auto Switch Mode Logic
            const targetMode = (type === 'npc_template' || type === 'npc_persona' || type === 'npc') ? 'npc' : 'user';
            const $modeBtn = $(`.pw-mode-item[data-mode="${targetMode}"]`);
            if (!$modeBtn.hasClass('active')) {
                $modeBtn.click(); // Trigger click to switch UI
            }

            if (type.includes('template')) {
                $('#pw-template-text').val(previewText);
                if(targetMode==='npc') store.npcContext.template = previewText;
                else store.userContext.template = previewText;
                saveData();
                renderTemplateChips();
                $('.pw-tab[data-tab="editor"]').click();
                if (!store.isEditingTemplate) {
                     $('#pw-toggle-edit-template').click();
                }
                toastr.success("已加载选中的模版");
            } else {
                $('#pw-request').val(item.request); $('#pw-result-text').val(previewText); $('#pw-result-area').show();
                $('#pw-request').addClass('minimized');
                $('.pw-tab[data-tab="editor"]').click();
            }
        });
        $el.find('.pw-hist-action-btn.del').on('click', function (e) {
            e.stopPropagation();
            if (confirm("删除?")) {
                const realIndex = (store.historyPage - 1) * HISTORY_PER_PAGE + index;
                store.historyCache.splice(realIndex, 1);
                saveData(); renderHistoryList();
            }
        });
        $list.append($el);
    });
};


// ---[新增] 渲染 API 配置预设下拉框 ---
function renderApiProfiles() {
    const savedState = loadState();
    const lc = savedState.localConfig || {};
    const profiles = lc.apiProfiles ||[];
    const $select = $('#pw-api-profile-select');
    if ($select.length === 0) return;
    $select.empty();

    if (profiles.length === 0) {
        $select.append('<option value="custom">-- 暂无已保存配置 --</option>');
    } else {
        profiles.forEach(p => {
            $select.append(`<option value="${p.id}">${p.name}</option>`);
        });
        $select.append('<option value="custom">-- 临时使用 (不保存) --</option>');
    }

    if (lc.activeApiProfileId && $select.find(`option[value="${lc.activeApiProfileId}"]`).length > 0) {
        $select.val(lc.activeApiProfileId);
    } else if (profiles.length > 0) {
        $select.val(profiles[0].id);
    } else {
        $select.val('custom');
    }
}

const renderWiBooks = async () => {
    const container = $('#pw-wi-container').empty();
    const baseBooks = await getContextWorldBooks();
    const allBooks = [...new Set([...baseBooks, ...(window.pwExtraBooks || [])])];
    
    if (allBooks.length === 0) { 
        container.html('<div style="opacity:0.6; padding:10px; text-align:center;">此角色未绑定世界书，请在“世界书”标签页手动添加或在酒馆主界面绑定。</div>'); 
        return; 
    }

    for (const book of allBooks) {
        const isBound = baseBooks.includes(book);
        const isPinned = window.pwPinnedBooks.includes(book);
        
        let statusLabel = '';
        if (isBound) statusLabel = '<span class="pw-bound-status">(已绑定)</span>';
        else if (isPinned) statusLabel = '<span class="pw-bound-status" style="color:var(--SmartThemeQuoteColor);">(已固定)</span>';

        const pinIcon = !isBound
            ? `<i class="fa-solid fa-thumbtack pw-pin-book-icon" title="${isPinned ? '取消固定' : '固定此世界书（跨角色卡保留）'}" style="cursor:pointer; margin-right:6px; opacity:${isPinned ? '1' : '0.4'}; color:${isPinned ? 'var(--SmartThemeQuoteColor)' : 'inherit'};"></i>`
            : '';
        const removeIcon = !isBound ? '<i class="fa-solid fa-times remove-book pw-remove-book-icon" title="移除"></i>' : '';

        const $el = $(`
        <div class="pw-wi-book">
            <div class="pw-wi-header" style="display:flex; align-items:center;">
                <input type="checkbox" class="pw-wi-header-checkbox pw-wi-select-all" title="全选/全不选 (仅选中当前可见条目)">
                <span class="pw-wi-book-title">
                    ${book} ${statusLabel}
                </span>
                <div class="pw-wi-header-actions">
                    <div class="pw-wi-filter-toggle" title="展开/收起筛选"><i class="fa-solid fa-filter"></i></div>
                    ${pinIcon}
                    ${removeIcon}
                    <i class="fa-solid fa-chevron-down arrow"></i>
                </div>
            </div>
            <div class="pw-wi-list" data-book="${book}"></div>
        </div>`);
        
        $el.find('.pw-wi-select-all').on('click', async function(e) {
            e.stopPropagation();
            $(this).removeClass('pw-indeterminate').prop('indeterminate', false);
            const checked = $(this).prop('checked');
            const $list = $el.find('.pw-wi-list');
            
            const doCheck = () => {
                $list.find('.pw-wi-item:visible .pw-wi-check').prop('checked', checked);
                const checkedUids = [];
                $list.find('.pw-wi-check:checked').each(function() { checkedUids.push($(this).val()); });
                saveWiSelection(book, checkedUids);
            };

            if (!$list.is(':visible') && !$list.data('loaded')) {
                $el.find('.pw-wi-header').click(); 
                setTimeout(doCheck, 150);
            } else {
                doCheck();
            }
        });

        $el.find('.pw-pin-book-icon').on('click', function(e) {
            e.stopPropagation();
            if (window.pwPinnedBooks.includes(book)) {
                window.pwPinnedBooks = window.pwPinnedBooks.filter(b => b !== book);
                toastr.info(`已取消固定「${book}」`);
            } else {
                window.pwPinnedBooks.push(book);
                toastr.success(`已固定「${book}」，将在所有角色卡中自动加载`);
            }
            savePinnedBooks();
            renderWiBooks();
        });

        $el.find('.remove-book').on('click', (e) => {
            e.stopPropagation();
            window.pwExtraBooks = window.pwExtraBooks.filter(b => b !== book);
            window.pwPinnedBooks = window.pwPinnedBooks.filter(b => b !== book);
            savePinnedBooks();
            renderWiBooks();
        });
        
        $el.find('.pw-wi-filter-toggle').on('click', function(e) {
            e.stopPropagation();
            const $list = $el.find('.pw-wi-list');
            if (!$list.is(':visible')) {
                $el.find('.pw-wi-header').click();
            }
            setTimeout(() => {
                const $tools = $list.find('.pw-wi-depth-tools');
                if($tools.length) {
                    $tools.slideToggle();
                }
            }, 50);
        });

        $el.find('.pw-wi-header').on('click', async function (e) {
            if ($(e.target).hasClass('pw-wi-header-checkbox') || $(e.target).closest('.pw-wi-filter-toggle').length || $(e.target).closest('.pw-remove-book-icon').length) return; 

            const $list = $el.find('.pw-wi-list');
            const $arrow = $(this).find('.arrow');
            
            if ($list.is(':visible')) { 
                $list.slideUp(); 
                $arrow.removeClass('fa-flip-vertical'); 
            } else {
                $list.slideDown(); 
                $arrow.addClass('fa-flip-vertical');
                
                if (!$list.data('loaded')) {
                    $list.html('<div style="padding:10px;text-align:center;"><i class="fas fa-spinner fa-spin"></i></div>');
                    
                    const entries = await getWorldBookEntries(book);
                    $list.empty();
                    
                    if (entries.length === 0) {
                        $list.html('<div style="padding:10px;opacity:0.5;">无条目</div>');
                    } else {
                        const $tools = $(`
                        <div class="pw-wi-depth-tools">
                            <div class="pw-wi-filter-row">
                                <input type="text" class="pw-keyword-input" id="keyword" placeholder="关键词查找...">
                            </div>
                            <div class="pw-wi-filter-row">
                                <select id="p-select" class="pw-pos-select">
                                    <option value="unknown">全部位置</option>
                                    <option value="before_character_definition">角色前</option>
                                    <option value="after_character_definition">角色后</option>
                                    <option value="before_author_note">AN前</option>
                                    <option value="after_author_note">AN后</option>
                                    <option value="before_example_messages">样例前</option>
                                    <option value="after_example_messages">样例后</option>
                                    <option value="at_depth_as_system">@深度(系统)</option>
                                    <option value="at_depth_as_assistant">@深度(助手)</option>
                                    <option value="at_depth_as_user">@深度(用户)</option>
                                </select>
                                <input type="number" class="pw-depth-input" id="d-min" placeholder="0" title="最小深度">
                                <span>-</span>
                                <input type="number" class="pw-depth-input" id="d-max" placeholder="Max" title="最大深度">
                            </div>
                            <div class="pw-wi-filter-row">
                                <button class="pw-depth-btn" id="d-filter-toggle" title="启用/取消筛选">筛选</button>
                                <button class="pw-depth-btn" id="d-clear-search">清空内容</button>
                                <button class="pw-depth-btn" id="d-reset" title="恢复为世界书原始状态">重置状态</button>
                            </div>
                        </div>`);
                        
                        let isFiltering = false;

                        const applyFilter = () => {
                            if (!isFiltering) {
                                $list.find('.pw-wi-item').show();
                                $tools.find('#d-filter-toggle').removeClass('active').text('筛选');
                                return;
                            }
                            $tools.find('#d-filter-toggle').addClass('active').text('取消筛选');
                            const keyword = $tools.find('#keyword').val().toLowerCase();
                            const pVal = $tools.find('#p-select').val();
                            const dMin = parseInt($tools.find('#d-min').val()) || 0;
                            const dMaxStr = $tools.find('#d-max').val();
                            const dMax = dMaxStr === "" ? 99999 : parseInt(dMaxStr);

                            $list.find('.pw-wi-item').each(function() {
                                const $row = $(this);
                                const d = $row.data('depth');
                                const code = $row.data('code'); 
                                const content = decodeURIComponent($row.find('.pw-wi-check').data('content')).toLowerCase();
                                const title = $row.find('.pw-wi-title-text').text().toLowerCase();
                                let matches = true;
                                if (keyword && !title.includes(keyword) && !content.includes(keyword)) matches = false;
                                if (matches && pVal !== 'unknown' && code !== pVal) matches = false;
                                if (matches && (d < dMin || d > dMax)) matches = false;
                                if (matches) $row.show(); else $row.hide();
                            });
                        };

                        $tools.find('#d-filter-toggle').on('click', function() {
                            isFiltering = !isFiltering;
                            applyFilter();
                        });

                        $tools.find('#keyword').on('keyup', function(e) {
                            if (e.key === 'Enter') {
                                isFiltering = true;
                                applyFilter();
                            }
                        });

                        $tools.find('#d-clear-search').on('click', function() {
                            $tools.find('#keyword').val('');
                            if(isFiltering) applyFilter();
                        });

                        $tools.find('#d-reset').on('click', function() {
                             $list.find('.pw-wi-item').each(function() {
                                 const originalEnabled = $(this).data('original-enabled');
                                 $(this).find('.pw-wi-check').prop('checked', originalEnabled).trigger('change');
                             });
                             toastr.info("已重置为世界书原始状态");
                        });

                        $list.append($tools);

                        const savedSelection = loadWiSelection(book);

                        entries.forEach(entry => {
                            let isChecked = false;
                            if (savedSelection) {
                                isChecked = savedSelection.includes(String(entry.uid));
                            } else {
                                isChecked = entry.enabled;
                            }
                            
                            const checkedAttr = isChecked ? 'checked' : '';
                            const posAbbr = getPosAbbr(entry.position);
                            const infoLabel = `<span class="pw-wi-info-badge" title="位置:深度">[${posAbbr}:${entry.depth}]</span>`;

                            const $item = $(`
                            <div class="pw-wi-item" data-depth="${entry.depth}" data-code="${getPosFilterCode(entry.position)}" data-original-enabled="${entry.enabled}">
                                <div class="pw-wi-item-row">
                                    <input type="checkbox" class="pw-wi-check" value="${entry.uid}" ${checkedAttr} data-content="${encodeURIComponent(entry.content)}">
                                    <div class="pw-wi-title-text">
                                        ${infoLabel} ${entry.displayName}
                                    </div>
                                    <i class="fa-solid fa-eye pw-wi-toggle-icon"></i>
                                </div>
                                <div class="pw-wi-desc">
                                    ${entry.content}
                                    <div class="pw-wi-close-bar"><i class="fa-solid fa-angle-up"></i> 收起</div>
                                </div>
                            </div>`);
                            
                            $item.find('.pw-wi-check').on('change', function() {
                                const checkedUids = [];
                                $list.find('.pw-wi-check:checked').each(function() { checkedUids.push($(this).val()); });
                                saveWiSelection(book, checkedUids);
                                updateWiHeaderCheckbox($el);
                            });

                            $item.find('.pw-wi-toggle-icon').on('click', function (e) {
                                e.stopPropagation();
                                const $desc = $(this).closest('.pw-wi-item').find('.pw-wi-desc');
                                if ($desc.is(':visible')) { $desc.slideUp(); $(this).removeClass('active'); } else { $desc.slideDown(); $(this).addClass('active'); }
                            });
                            
                            $item.find('.pw-wi-close-bar').on('click', function () { 
                                const $desc = $(this).parent();
                                $desc.stop(true, true).slideUp(); 
                                $item.find('.pw-wi-toggle-icon').removeClass('active'); 
                            });
                            
                            $list.append($item);
                        });
                    }
                    $list.data('loaded', true);
                    updateWiHeaderCheckbox($el);
                }
            }
        });

        // Set initial indeterminate state: entries exist but list not yet expanded
        const initSel = loadWiSelection(book);
        const $cb = $el.find('.pw-wi-select-all');
        if (initSel === null || (initSel.length > 0)) {
            $cb.prop('indeterminate', true).addClass('pw-indeterminate');
        }

        container.append($el);
    }
};

function updateWiHeaderCheckbox($bookEl) {
    const $checks = $bookEl.find('.pw-wi-check');
    if ($checks.length === 0) return;
    const total = $checks.length;
    const checked = $checks.filter(':checked').length;
    const $header = $bookEl.find('.pw-wi-select-all');
    if (checked === 0) {
        $header.prop('checked', false).prop('indeterminate', false).removeClass('pw-indeterminate');
    } else if (checked === total) {
        $header.prop('checked', true).prop('indeterminate', false).removeClass('pw-indeterminate');
    } else {
        $header.prop('checked', false).prop('indeterminate', true).addClass('pw-indeterminate');
    }
}

const renderGreetingsList = () => {
    const list = getCharacterGreetingsList();
    store.currentGreetingsList = list;
    const $select = $('#pw-greetings-select').empty();
    $select.append('<option value="">(不使用开场白)</option>');
    list.forEach((item, idx) => {
        $select.append(`<option value="${idx}">${item.label}</option>`);
    });
};

function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}

jQuery(async () => {
    addPersonaButton(); 
    bindEvents(); 
    console.log("[PW] Persona Weaver loaded");
});
