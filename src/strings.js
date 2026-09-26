// UI 文案注册表：跨层消费的纯数据叶子（toast／标题文案），改文案不改键名。
export const TEXT = {
    PANEL_TITLE: `<span class="pw-title-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span>User人设生成器`,
    BTN_TITLE: "打开设定生成器",
    TOAST_SAVE_SUCCESS: (name) => `Persona "${name}" 已保存并覆盖！`,
    TOAST_WI_SUCCESS: (book, name) => `已写入世界书: ${book} (条目: ${name})`,
    TOAST_WI_FAIL: "当前角色未绑定世界书，无法写入",
    TOAST_WI_WRITE_FAIL: "写入世界书失败：",
    TOAST_LOAD_CURRENT: "已读取当前内容",
    TOAST_QUOTA_ERROR: "浏览器存储空间不足 (Quota Exceeded)，请清理浏览器存储。"
};
