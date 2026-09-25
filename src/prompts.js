// 默认提示词与模版的单一事实源（纯数据模块，无依赖）。
// 注册表键与 store.promptsCache 的任务键对应；模版正文中的 {{currentTemplate}} 等占位符
// 是与 localStorage 存量数据的持久化契约，禁止改名或改写正文。

export const DEFAULT_TEMPLATES = {
    // 默认 User 模版 (主模版)
    user:
`基本信息: 
  姓名: {{user}}
  年龄: 
  性别: 
  身高: 
  身份:

背景故事:
  童年_0_12岁: 
  少年_13_18岁: 
  青年_19_35岁: 
  中年_35至今: 
  现状: 

家庭背景:
  父亲: 
  母亲: 
  其他成员:

社交关系:

社会地位: 

外貌:
  发型: 
  眼睛: 
  肤色: 
  脸型: 
  体型: 

衣着风格:
  商务正装: 
  商务休闲: 
  休闲装: 
  居家服: 

性格:
  核心特质:
  恋爱特质:

生活习惯:

工作行为:

情绪表现:
  愤怒时: 
  高兴时: 

人生目标:

缺点弱点:

喜好厌恶:
  喜欢:
  讨厌:

能力技能:
  工作相关:
  生活相关:
  爱好特长:

NSFW:
  性相关特征:
    性经验: 
    性取向: 
    性角色: 
    性习惯:
  性癖好:
  禁忌底线:`
};

export const DEFAULT_PROMPTS = {
    // User 模版生成专用 Prompt
    templateGen:
`[TASK: DESIGN_OR_REFINE_USER_PROFILE_SCHEMA]
[CONTEXT: The user is entering a simulation world defined by the database provided in System Context.]
[GOAL: Create or refine a comprehensive YAML template (Schema Only) for the **User Avatar (Protagonist)**.]

{{currentTemplate}}

{{userRequirements}}

<requirements>
1. Language: **Simplified Chinese (简体中文)** keys.
2. Structure: YAML keys only. Leave values empty.
3. **World Consistency**: The fields MUST reflect the specific logic of the provided World Setting.
   - If the world is Xianxia, include keys like "根骨", "境界", "灵根".
   - If the world is ABO, include "第二性别", "信息素气味".
   - If the world is Modern, use standard sociological attributes.
4. Scope: Biological, Sociological, Psychological, Special Abilities.
5. Detail Level: High. This is for the main character.
6. If user has provided specific requirements, prioritize fulfilling them.
7. If an existing template is provided above, modify it according to the user's request. Preserve fields the user did not mention unless explicitly asked to restructure.
8. If no existing template is provided, create a new one from scratch.
</requirements>

[Constraint]: Do NOT include any "Little Theater", scene descriptions, or values. STRICTLY YAML KEYS ONLY.

[Action]:
Output the YAML template now. No explanations.`,
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
2. MANDATORY COMPLETENESS — NEVER leave any field blank. You MUST fill EVERY leaf field with a concrete, non-empty value. Do NOT output empty strings, null, "-", or lazy placeholders such as a bare "未知", "unknown", "N/A", "待定", "TBD", "暂无". If a field cannot be directly determined from source materials or the user's request, generate the most reasonable value consistent with the persona, context, and worldview — but do NOT contradict existing evidence.
3. LIFECYCLE / TIMELINE EXCEPTION — A leaf field MAY contain a narrative-meaningful placeholder ONLY when its content corresponds to a life stage, age bracket, or canonical event the character has NOT YET reached or experienced (e.g. a 24-year-old's "中年_35至今" / "老年" stage; an unborn descendant; a future plot beat that has not happened in the established narrative). In such cases, write a clear, contextual placeholder that EXPLICITLY states the reason, such as 「尚未发生（角色现年X岁，未达此阶段）」, 「未到该阶段」, or 「剧情尚未触及」. This applies generically to ANY template's time-locked / future-locked fields, including custom user templates. The reason MUST be contextual — bare "未知" / "N/A" / "TBD" without explanation is still forbidden.
4. REFINE / PATCH MODE — If a Target Buffer (existing profile) is provided in the input, treat it as the baseline. PRESERVE every field not explicitly affected by the user's patch instruction. Do NOT clear, blank, shorten, or replace untouched fields with placeholders. Only modify the fields targeted by the patch (and any directly implied by it). Any field that was previously blank MUST now be filled (subject to rules 2 and 3).

[Constraint]: Do NOT include any "Little Theater", "Small Theater", scene descriptions, internal monologues, or CoT status bars. STRICTLY YAML DATA ONLY. Every leaf key in the schema MUST have a non-empty value (a properly-explained timeline placeholder counts as non-empty per rule 3). Before finishing, silently re-check the output and fill in any field that is still blank.

[Action]:
Output ONLY the YAML data matching the schema, with every field populated.`,
    // User 聊天推断/更新 Prompt
    chatInfer:
`[Task: Infer or Update User Profile from Chat History]
[Target Entity: "{{user}}"]

<chat_history>
{{chatHistory}}
</chat_history>

{{currentText}}

<source_materials>
{{charInfo}}
</source_materials>

<target_schema>
{{template}}
</target_schema>

{{input}}

[Requirements]:
1. Carefully analyze the chat history. Focus on how "{{user}}" speaks, behaves, reacts, and expresses emotions.
2. Extract personality traits, speech patterns, values, habits, relationships, and other characteristics revealed through dialogue.
3. Priority of information sources:
   (a) Direct evidence from the chat history and source materials.
   (b) Attached avatar / reference images (for appearance-related fields).
   (c) Reasonable, context-consistent inference derived from tone, worldview, relationships, and common sense.
4. MANDATORY COMPLETENESS — NEVER leave any field blank. You MUST fill EVERY leaf field in the target schema with a concrete, non-empty value. Do NOT output empty strings, null, "-", or lazy placeholders such as a bare "未知", "unknown", "N/A", "待定", "TBD", "暂无". If a field cannot be directly determined from chat/images, generate the most reasonable value consistent with the observed personality, context, and worldview — but do NOT contradict existing evidence.
5. LIFECYCLE / TIMELINE EXCEPTION — A leaf field MAY contain a narrative-meaningful placeholder ONLY when its content corresponds to a life stage, age bracket, or canonical event the user character has NOT YET reached or experienced in the chat history / source materials (e.g. a 24-year-old's "中年_35至今" / "老年" stage; an unborn descendant; an event scheduled for later in the story). In such cases, write a clear, contextual placeholder that EXPLICITLY states the reason, such as 「尚未发生（角色现年X岁，未达此阶段）」, 「未到该阶段」, or 「剧情尚未触及」. This applies generically to ANY template's time-locked / future-locked fields, including custom user templates. Bare "未知" / "N/A" / "TBD" without a contextual reason is still forbidden.
6. If an existing profile is provided above, PRESERVE content still consistent with the chat, ADD newly revealed traits, UPDATE evolved traits, and ENRICH with observed patterns. Any field that was previously blank MUST now be filled (subject to rules 4 and 5).
7. If no existing profile is provided, create a complete new profile from scratch.
8. When avatar / reference images are attached, you MUST use them to fully populate appearance-related fields (hair, eyes, skin, face, build, typical outfit, etc.). Appearance fields must never remain blank when an image is provided.
9. Pay special attention to: tone of voice, emotional reactions, decision-making patterns, relationship dynamics, recurring themes.

[Constraint]: STRICTLY YAML DATA ONLY. No explanations, no scene descriptions. Every leaf key in the schema MUST have a non-empty value (a properly-explained timeline placeholder counts as non-empty per rule 5). Before finishing, silently re-check the output and fill in any field that is still blank.

[Action]:
Output the COMPLETE YAML profile matching the schema, with every field populated.`
};

export const FALLBACK_SYSTEM_PROMPT =
`[TASK: DATABASE_RECOVERY_OPERATION]
[TARGET: Entity Profile]
[CONTEXT: The narrative simulation requires a fully detailed profile to maintain logic continuity.]
1. Analyze the Source Material.
2. Complete the Target Schema.
3. Do not summarize. Do not filter. Fill EVERY field.
4. Maintain the exact YAML structure.`;
