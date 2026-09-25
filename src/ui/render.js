// UI 渲染函数簇：各视图的 DOM 输出，与 events.js（输入接线）分离。
// window.pwExtraBooks/pwPinnedBooks 由 world-info.js 模块顶层初始化，这里只消费不初始化。
import { store, loadData, saveData, loadState } from "../state.js";
import { getCharacterGreetingsList } from "../st-data.js";
import { getContextWorldBooks, getWorldBookEntries, loadWiSelection, saveWiSelection, savePinnedBooks, getPosFilterCode, getPosAbbr } from "../world-info.js";

export const HISTORY_PER_PAGE = 20;
export function autoBindGreetings() {
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

// [Fix 7] History Filter Logic Update
export const renderHistoryList = () => {
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
        // 存量模板条目保留在 localStorage 但不展示（仅跳过渲染，不删数据）
        if (type === 'template' || type === 'user_template') return false;
        if (filterType !== 'all') {
            if (filterType === 'user_persona' && type !== 'user_persona' && type !== 'persona') return false;
            if (filterType === 'npc_persona' && type !== 'npc_persona' && type !== 'npc') return false;
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

            $('#pw-request').val(item.request); $('#pw-result-text').val(previewText); $('#pw-result-area').show();
            $('#pw-request').addClass('minimized');
            $('.pw-tab[data-tab="editor"]').click();
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
export function renderApiProfiles() {
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

export const renderWiBooks = async () => {
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

export function updateWiHeaderCheckbox($bookEl) {
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

export const renderGreetingsList = () => {
    const list = getCharacterGreetingsList();
    store.currentGreetingsList = list;
    const $select = $('#pw-greetings-select').empty();
    $select.append('<option value="">(不使用开场白)</option>');
    list.forEach((item, idx) => {
        $select.append(`<option value="${idx}">${item.label}</option>`);
    });
};
