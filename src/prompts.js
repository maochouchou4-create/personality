// 默认提示词与模版的单一事实源（纯数据模块，无依赖）。
// 注册表键与 store.promptsCache 的任务键对应；正文里的占位符由 generation.js 组装替换，
// 键名与占位符一经发布即持久化契约，禁止改名或改写正文。

export const DEFAULT_TEMPLATES = {
    // 默认 User 模版 (主模版)
    user:
`基本信息:
  姓名: {{user}}
  年龄:
  性别:
  身份:
外貌:
  概貌:
  标志性特征:
性格:
  核心特质:
  说话风格:
  行为习惯:
背景:
  来历一句话:
  现状:
连接:
  与当前世界的关联:
喜恶:
  喜欢:
  讨厌:
NSFW:
  基本倾向:
  禁忌底线:`
};

export const DEFAULT_PROMPTS = {
    // 策展 Prompt：只产出 schema 结构（键），不填值。世界书经独立 system 消息注入；
    // {{userRequirements}} 由调用方替换，无额外需求时为空串。
    curator:
`[TASK: CURATE_PROFILE_SCHEMA]
[CONTEXT: You are designing a YAML profile schema (keys only, values empty) for the reader's own character (the User Avatar) in this simulation world. The profile will be read ALONGSIDE the World Setting database provided in this conversation — readers always see both documents together.]

<source_materials>
{{charInfo}}
</source_materials>

{{userRequirements}}

[PRINCIPLES — apply in order]:
1. COMPLEMENT, NEVER DUPLICATE: The World Setting is already known to the reader. FORBID any field whose content would merely restate what the World Setting already states (world rules, lore, geography, factions, other characters' backgrounds). A field is allowed only if it captures something SPECIFIC TO THIS CHARACTER that the World Setting does not provide.
2. WORLD-FLAVORED KEYS: Where the world defines mechanics relevant to this character (e.g. cultivation realms, second gender, cybernetics), add keys in that world's vocabulary — one key per mechanic that matters for roleplay, no more.
3. SCALE TO THE SOURCE: World Settings vary widely. Some provide rich, specific hooks for this character's place in the world; others are broad lore with little personal connection. Match the schema's breadth to what the setting actually gives: rich hooks → a fuller schema; broad or thin → stay lean and identity-focused (who they are, how they present, what they carry into the world). Never pad with fields the setting cannot inform.
4. LEAN BY DEFAULT: Start from the base blocks below and ADD only what this world and the user's requirements justify. Fewer, sharper fields beat exhaustive forms. Never exceed 10 top-level blocks.
5. PROTAGONIST FOCUS: This is the reader's own character — identity, personality, appearance, and their connection to this world matter most; social blocks stay light.

<base_blocks>
基本信息 / 外貌 / 性格 / 背景 / 喜恶 / NSFW
</base_blocks>

[Constraint]: YAML keys only, values empty, Simplified Chinese keys. No explanations. Output a single \`\`\`yaml block.

[Action]:
Output the curated YAML schema now.`,
    // User 人设生成/润色 Prompt
    personaGen:
`[Task: Generate/Refine User Profile]
[Target Entity: "{{user}}"]

<source_materials>
{{charInfo}}
{{greetings}}
</source_materials>

<target_schema>
{{template}}
</target_schema>

{{input}} 

[Requirements]:
1. Follow the YAML schema exactly. Output every leaf field defined in the schema.
2. COMPLEMENT, DON'T RESTATE — The World Setting database is displayed alongside this profile. NEVER copy or paraphrase world lore into field values. When a field relates to an established world fact, answer with THIS character's specific take in one short phrase (e.g. this character's particular 灵根, not what 灵根 means in this world).
3. CONCISE VALUES — Each leaf value is one short phrase or sentence (≤20 Chinese characters), unless the block is explicitly narrative (e.g. 背景故事). No filler, no padding, no restating the field name.
4. SPECIFIC OVER GENERIC — Prefer bold, concrete, playable details (a named habit, a visible tell, a stated preference) over safe abstract traits.
5. MANDATORY COMPLETENESS — NEVER leave any field blank. You MUST fill EVERY leaf field with a concrete, non-empty value. Do NOT output empty strings, null, "-", or lazy placeholders such as a bare "未知", "unknown", "N/A", "待定", "TBD", "暂无". If a field cannot be directly determined from source materials or the user's request, generate the most reasonable value consistent with the persona, context, and worldview — but do NOT contradict existing evidence.
6. LIFECYCLE / TIMELINE EXCEPTION — A leaf field MAY contain a narrative-meaningful placeholder ONLY when its content corresponds to a life stage, age bracket, or canonical event the character has NOT YET reached or experienced (e.g. a 24-year-old's "中年_35至今" / "老年" stage; an unborn descendant; a future plot beat that has not happened in the established narrative). In such cases, write a clear, contextual placeholder that EXPLICITLY states the reason, such as 「尚未发生（角色现年X岁，未达此阶段）」, 「未到该阶段」, or 「剧情尚未触及」. This applies generically to ANY template's time-locked / future-locked fields, including custom user templates. The reason MUST be contextual — bare "未知" / "N/A" / "TBD" without explanation is still forbidden.
7. REFINE / PATCH MODE — If a Target Buffer (existing profile) is provided in the input, treat it as the baseline. PRESERVE every field not explicitly affected by the user's patch instruction. Do NOT clear, blank, shorten, or replace untouched fields with placeholders. Only modify the fields targeted by the patch (and any directly implied by it). Any field that was previously blank MUST now be filled (subject to rules 5 and 6).

[Constraint]: Do NOT include any "Little Theater", "Small Theater", scene descriptions, internal monologues, or CoT status bars. STRICTLY YAML DATA ONLY. Every leaf key in the schema MUST have a non-empty value (a properly-explained timeline placeholder counts as non-empty per rule 6). Before finishing, silently re-check the output and fill in any field that is still blank. Values stay concise per rule 3; no value may restate World Setting content.

[Action]:
Output ONLY the YAML data matching the schema, with every field populated.`
};

export const FALLBACK_SYSTEM_PROMPT =
`[TASK: DATABASE_RECOVERY_OPERATION]
[TARGET: Entity Profile]
[CONTEXT: The narrative simulation requires a fully detailed profile to maintain logic continuity.]
1. Analyze the Source Material.
2. Complete the Target Schema.
3. Do not summarize. Do not filter. Fill EVERY field.
4. Maintain the exact YAML structure.`;
