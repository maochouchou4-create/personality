// 面板 HTML 构建＋打开＋打开时初始化。模板字符串与初始化序列强耦合，整体搬移不内拆。
import { getContext } from "../../../../../extensions.js";
import { callPopup } from "../../../../../../script.js";
import { store, loadData, loadState, saveState } from "../state.js";
import { defaultSettings } from "../api.js";
import { getPresetHintText } from "../generation.js";
import { loadAvailableWorldBooks } from "../world-info.js";
import { fetchAvatarAsBase64 } from "../st-data.js";
import { TEXT } from "../strings.js";
import { autoBindGreetings, renderApiProfiles, renderAvatarStrip, renderGreetingsList, renderTemplateChips, renderWiBooks } from "./render.js";

export async function openCreatorPopup() {
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

    const chatHistEnabled = store.uiStateCache.chatHistory && store.uiStateCache.chatHistory.enabled;
    const activeData = store.userContext;
    
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
            <!-- Load Persona Entry -->
            <div class="pw-info-display">
                <div class="pw-load-btn" id="pw-btn-load-current">载入已有人设</div>
            </div>

            <div>
                <div class="pw-tags-header">
                    <span class="pw-tags-label" id="pw-template-block-header" style="cursor:pointer; user-select:none;">
                        模版块 (点击填入) 
                        <i class="fa-solid ${chipsIcon}" style="margin-left:5px;" title="折叠/展开"></i>
                    </span>
                    <div class="pw-tags-actions">
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
                        <div class="pw-mini-btn" id="pw-reset-template-small" title="恢复为默认模版" style="margin-left:auto; padding:2px 8px; font-size:0.8em; border:none; background:transparent; opacity:0.6;"><i class="fa-solid fa-rotate-left"></i></div>
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
            <button id="pw-btn-gen" class="pw-btn gen"><i class="fa-solid ${chatHistEnabled ? 'fa-comments' : 'fa-wand-magic-sparkles'}"></i> ${chatHistEnabled ? '聊天推断生成' : '生成 User 设定'}</button>

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
                <button class="pw-btn save" id="pw-btn-apply">覆盖当前人设</button>
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
