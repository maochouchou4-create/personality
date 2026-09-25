// DEFAULT_TEMPLATES.user 的结构契约：顶层块清单与顺序、每块叶子数上限、{{user}} 占位符、可解析性。
// 只测结构不测内容语义——正文是提示词工程的常态迭代区，逐字断言会让每次调优都变红。
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TEMPLATES } from "../src/prompts.js";
import { parseYamlToBlocks } from "../src/yaml.js";

// 顶层块顺序即展示顺序。基本信息/外貌/性格/背景/喜恶/NSFW 六块与 curator 的 base_blocks 对齐；
// 「连接」是默认模板独有的回退增补（零策展素材时保底人设与世界的关联），不进 base_blocks。
// 增删块须同批改此处与 src/prompts.js 两处。
const EXPECTED_BLOCKS = ["基本信息", "外貌", "性格", "背景", "连接", "喜恶", "NSFW"];
// 叶子数上限来自「LEAN BY DEFAULT」：单块超过 4 项即回到胖模板的老路。
const MAX_LEAVES_PER_BLOCK = 4;

test("顶层块恰为既定清单且顺序一致", () => {
    const blocks = parseYamlToBlocks(DEFAULT_TEMPLATES.user);
    assert.deepEqual([...blocks.keys()], EXPECTED_BLOCKS);
});

test("每块叶子数在 1-4 之间", () => {
    const blocks = parseYamlToBlocks(DEFAULT_TEMPLATES.user);
    for (const name of EXPECTED_BLOCKS) {
        const leaves = blocks.get(name).split("\n").filter((line) => line.trim().length > 0);
        assert.ok(leaves.length >= 1, `${name} 无叶子`);
        assert.ok(leaves.length <= MAX_LEAVES_PER_BLOCK, `${name} 叶子数 ${leaves.length} 超过上限`);
    }
});

test("含 {{user}} 占位符", () => {
    assert.ok(DEFAULT_TEMPLATES.user.includes("{{user}}"));
});

test("parseYamlToBlocks 可解析出全部顶层块", () => {
    const blocks = parseYamlToBlocks(DEFAULT_TEMPLATES.user);
    assert.equal(blocks.size, EXPECTED_BLOCKS.length);
});