// ESM resolve hook：把 ST 宿主模块（extensions.js / script.js）的 specifier 重定向到
// tests/host-stub.mjs。src 的模块链式 import 宿主文件（如 src/world-info.js →
// ../../../../../script.js），在仓外不可解析，node:test 下必须桩掉。
// pattern 只拦「若干级 ../ + extensions|script.js」的宿主形态（^ $ 全锚定，
// 防未来 npm 依赖内部的 ../script.js 形态相对导入被误重定向）；"./"、"../" 开头的
// 仓内相对模块一律放行走默认解析（拍板：不拦仓内模块）。
const HOST_SPECIFIER = /^(\.\.\/)+(extensions|script)\.js$/;
const STUB_URL = new URL("./host-stub.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
    if (HOST_SPECIFIER.test(specifier)) {
        return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
