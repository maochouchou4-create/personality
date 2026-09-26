// ST 运行时取数适配层：角色信息 / 开场白 / 用户人格描述的唯一取数通道，供生成域与 UI 侧消费。
// SillyTavern / window / $ 为宿主全局，不经 import；getContext 走 ST 的 extensions 模块边界。
import { getContext } from "../../../../extensions.js";
import { power_user } from "../../../../scripts/power-user.js";
import { user_avatar } from "../../../../scripts/personas.js";

export function getCharacterInfoText() {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined || !context.characters[charId]) return "";
    const char = context.characters[charId];
    const data = char.data || char;
    let text = "";
    if (data.description) text += `Description:\n${data.description}\n`;
    if (data.personality) text += `Personality:\n${data.personality}\n`;
    if (data.scenario) text += `Scenario:\n${data.scenario}\n`;
    return text;
}

export function getCharacterGreetingsList() {
    const context = getContext();
    const charId = context.characterId;
    if (charId === undefined || !context.characters[charId]) return [];
    const char = context.characters[charId];
    const data = char.data || char;
    const list = [];
    if (data.first_mes) {
        list.push({ label: "开场白 #0", content: data.first_mes });
    }
    if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((greeting, index) => {
            list.push({ label: `开场白 #${index + 1}`, content: greeting });
        });
    }
    return list;
}

export function getActivePersonaDescription() {
    const domVal = $('#persona_description').val();
    if (domVal !== undefined && domVal !== null) return domVal;
    // 主路径＝单数镜像字段（宿主对当前选中人设持续同步，personas.js:925）；
    // 回退＝descriptor 真源。personas 映射的值是显示名不是描述（旧回退链拿错形状）。
    if (power_user.persona_description) return power_user.persona_description;
    return power_user.persona_descriptions?.[user_avatar]?.description || "";
}
