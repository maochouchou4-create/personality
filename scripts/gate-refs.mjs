// 断言符号引用形态。absent＝文件集内不得出现裸引用（obj.sym 点号引用与 $ 前缀标识符不计；
// 注释内命中也计违例，选符号时先核对注释）。absentDecl＝不得出现顶层声明形态
//（含 export 前缀的 export let/const/var/function），供「对象属性键合法、旧声明必须消失」的场景。
// present＝文件集内每个文件都至少一处裸引用。sym 为标识符或点号路径（正则元字符自动转义）。
// 用法: node scripts/gate-refs.mjs <absent|absentDecl|present> <symbol> <file...>   exit 0=绿
import { readFileSync } from "node:fs";

const [, , mode, sym, ...files] = process.argv;
if (!["absent", "absentDecl", "present"].includes(mode) || !sym || files.length === 0) {
    console.error("用法: node gate-refs.mjs <absent|absentDecl|present> <symbol> <file...>"); process.exit(2);
}
const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hits = [];
for (const f of files) {
    const src = readFileSync(f, "utf8");
    let bad;
    if (mode === "absentDecl") bad = new RegExp("^(?:export\\s+)?(?:let|const|var|function|async function)\\s+" + esc + "\\b", "m").test(src);
    else {
        const n = (src.match(new RegExp("(^|[^.\\w$])" + esc + "\\b", "g")) || []).length;
        bad = mode === "absent" ? n > 0 : n === 0;
    }
    if (bad) hits.push(f);
}
if (hits.length) { console.error("gate-refs " + mode + " " + sym + " 违例: " + hits.join(", ")); process.exit(1); }
console.log("gate-refs " + mode + " " + sym + " 通过");
