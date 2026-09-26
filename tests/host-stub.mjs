// ST 宿主桩：导出名按全仓 grep 实核的被引名给全（getContext ×多处、
// saveSettingsDebounced（world-info.js）、callPopup（ui/panel.js））。
// 测试只触纯函数路径，桩仅需可导入，不模拟宿主行为。
export function getContext() {
    return {};
}

export function saveSettingsDebounced() {
    return Promise.resolve();
}

export function callPopup() {
    return Promise.resolve("");
}
