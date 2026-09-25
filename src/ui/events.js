// 全部事件绑定的注册（接线层）。按视图内拆是后置清单——闭包共享状态需先重构，本批只整体搬移。
// addPersonaButton 与 bindEvents 同文件：bindEvents 将其注册为 APP_READY/MOVABLE_PANELS_RESET 处理器，须同模块作用域。
import { getContext } from "../../../../../extensions.js";
import { store, getCurrentTemplate, loadData, saveData, saveHistory, saveAvatarImages, loadState, saveState } from "../state.js";
import { DEFAULT_TEMPLATES } from "../prompts.js";
import { getCharacterInfoText, fetchChatHistoryFiltered, scanChatTags, getActivePersonaDescription } from "../st-data.js";
import { runGeneration, collectContextData, getPresetHintText } from "../generation.js";
import { forceSavePersona, syncToWorldInfoViaHelper, getContextWorldBooks, getWorldBookEntries } from "../world-info.js";
import { renderDiffComparison, assembleDiffResult } from "../diff.js";
import { TEXT } from "../strings.js";
import { renderApiProfiles, renderAvatarMgmt, renderAvatarStrip, renderHistoryList, renderTemplateChips, renderWiBooks } from "./render.js";
import { openCreatorPopup } from "./panel.js";

const BUTTON_ID = 'pw_persona_tool_btn';

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

export function bindEvents() {
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
            $('#pw-btn-gen').html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
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

    // Reset Template Small Button
    $(document).on('click.pw', '#pw-reset-template-small', function() {
        if(confirm("确定要恢复为默认的 User 模版吗？")) {
            const fallbackT = DEFAULT_TEMPLATES.user;
            $('#pw-template-text').val(fallbackT);
            store.userContext.template = fallbackT;
            saveData();
            if(!store.isEditingTemplate) renderTemplateChips();
            toastr.success("已恢复默认 User 模版");
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
                    const fallbackT = DEFAULT_TEMPLATES.user;
                    
                    $('#pw-template-text').val(fallbackT);
                    store.userContext.template = fallbackT;
                    saveData();
                    renderTemplateChips();
                    toastr.success("已恢复默认 User 模板");
                    
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
                
                store.userContext.template = generatedTemplate;
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
        
        store.userContext.template = val;
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
        $('#pw-request').attr('placeholder', '在此输入要求，或点击上方模版块插入参考结构（无需全部填满）...');
        $('#pw-btn-gen').html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
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
        store.userContext.template = resultText;
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

            store.userContext.request = curReq;
            store.userContext.result = curRes;
            store.userContext.hasResult = hasRes;

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
            if (isTemplateGen) {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成模版');
            } else if (chatInferOn) {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-comments"></i> 聊天推断生成');
            } else {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
            }
            store.isProcessing = false;
        }
    });

    $(document).on('click.pw', '#pw-load-overlay-close', () => $('#pw-load-overlay').animate({opacity: 0}, 200, function() { $(this).css('display', 'none'); }));

    $(document).on('click.pw', '#pw-btn-load-current', async function() {
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
                    tags: ['user'],
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
            if (!store.isEditingTemplate) $btn.html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
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

export function addPersonaButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;
    const newButton = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-wand-magic-sparkles interactable" title="${TEXT.BTN_TITLE}" tabindex="0" role="button"></div>`);
    newButton.on('click', openCreatorPopup);
    container.prepend(newButton);
}
