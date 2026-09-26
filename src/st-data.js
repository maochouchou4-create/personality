// ST 运行时取数适配层：角色信息 / 开场白 / 用户人格描述的唯一取数通道，供生成域与 UI 侧消费。
// SillyTavern / window / $ 为宿主全局，不经 import；getContext 走 ST 的 extensions 模块边界。
import { getContext } from "../../../../extensions.js";

export function getCharacterInfoText() {
    const context = getContext();
    const charId = SillyTavern.getCurrentChatId ? SillyTavern.characterId : context.characterId;
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
    const context = getContext();
    if (context && context.powerUserSettings) {
        if (context.powerUserSettings.persona_description) return context.powerUserSettings.persona_description;
        const selected = context.powerUserSettings.persona_selected;
        if (selected && context.powerUserSettings.personas && context.powerUserSettings.personas[selected]) {
            return context.powerUserSettings.personas[selected];
        }
    }
    return "";
}
