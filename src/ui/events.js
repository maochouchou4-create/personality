// 全部事件绑定的注册（接线层）。按视图内拆是后置清单——闭包共享状态需先重构，本批只整体搬移。
// addPersonaButton 与 bindEvents 同文件：bindEvents 将其注册为 APP_READY/MOVABLE_PANELS_RESET 处理器，须同模块作用域。
import { getContext } from "../../../../../extensions.js";
import { store, loadData, saveData, saveHistory, loadState, saveState } from "../state.js";
import { getActivePersonaDescription } from "../st-data.js";
import { runGeneration, collectContextData, getPresetHintText } from "../generation.js";
import { forceSavePersona, syncToWorldInfoViaHelper, getContextWorldBooks, getWorldBookEntries } from "../world-info.js";
import { renderDiffComparison, assembleDiffResult } from "../diff.js";
import { TEXT } from "../strings.js";
import { renderApiProfiles, renderHistoryList, renderWiBooks } from "./render.js";
import { openCreatorPopup } from "./panel.js";

const BUTTON_ID = 'pw_persona_tool_btn';

const forcePaint = () => new Promise(resolve => setTimeout(resolve, 50));

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
        }
    });
    $(document).on('focus.pw', '#pw-result-text', function() {
        if ($('#pw-result-area').is(':visible')) {
            $(this).removeClass('minimized');
            $('#pw-request').addClass('minimized');
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
        if (!refineReq) {
            toastr.warning("请输入润色意见");
            store.isProcessing = false;
            return;
        }
        
        store.lastRefineRequest = refineReq;

        if(!store.promptsCache.personaGen) loadData();

        const oldText = $('#pw-result-text').val();
        const $btn = $(this).find('i').removeClass('fa-magic').addClass('fa-spinner fa-spin');
        
        await forcePaint();

        try {
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                mode: 'refine', 
                request: refineReq, 
                currentText: oldText, 
                wiText: contextData.wi,           
                greetingsText: contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            const responseText = await runGeneration(config, config);

            // 复用提取出来的渲染函数
            renderDiffComparison(oldText, responseText);

            $('#pw-diff-overlay').data('source', 'persona');

            $('#pw-diff-overlay').fadeIn();
            $('#pw-refine-input').val(''); // 清空输入框
        } catch (e) { 
            console.error(e);
            toastr.error("润色失败: " + e.message); 
        } finally { 
            $btn.removeClass('fa-spinner fa-spin').addClass('fa-magic');
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
            const config = {
                mode: 'refine', 
                request: store.lastRefineRequest,
                currentText: oldText, 
                wiText: contextData.wi,           
                greetingsText: contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            
            const responseText = await runGeneration(config, config);

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

    // Generate Persona
    $(document).on('click.pw', '#pw-btn-gen', async function (e) {
        e.preventDefault();
        
        if (store.isProcessing) return;
        store.isProcessing = true;

        // 需求已改为可选（额外需求）：空需求＝纯全自动链，由 curator 按世界书自行策展
        const req = $('#pw-request').val();
        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 生成中...');
        
        await forcePaint();
        
        $('#pw-refine-input').val('');
        $('#pw-result-text').val('');

        try {
            const contextData = await collectContextData();
            const modelVal = $('#pw-api-source').val() === 'independent' ? $('#pw-api-model-select').val() : null;
            const config = {
                mode: 'initial', 
                request: req || '',
                currentText: '',
                wiText: contextData.wi,
                greetingsText: contextData.greetings,
                apiSource: $('#pw-api-source').val(), 
                indepApiUrl: $('#pw-api-url').val(),
                indepApiKey: $('#pw-api-key').val(), 
                indepApiModel: modelVal
            };
            const text = await runGeneration(config, config);
            $('#pw-result-text').val(text);
            $('#pw-result-area').fadeIn();
            $('#pw-request').addClass('minimized');
            saveCurrentState();
            $('#pw-result-text').trigger('input');
        } catch (e) { 
            console.error(e);
            toastr.error(e.message); 
        } finally { 
            $btn.prop('disabled', false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> 生成 User 设定');
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
