# 🧙‍♂️ Persona Weaver (User人设生成器)

[中文] | [English](#english)

SillyTavern 原生扩展插件。旨在利用 AI 智能生成、深度润色和管理您的 User Persona（用户人设），支持智能对比编辑与世界书自动联动。

## ✨ 核心功能

*   **AI 智能生成**：根据可选的自然语言需求，AI 先按世界书策展个性化 YAML 结构，再生成结构化、高质量的用户人设。
*   **深度润色 & 智能对比**：
    *   对现有设定不满意？输入修改意见，AI 智能重写。
    *   提供 **Diff (差异对比)** 视图，直观展示修改前后的变化，支持选择性保留或直接编辑。
*   **世界书联动**：自动检测当前绑定的世界书，将设定作为条目一键写入，实现剧情深度绑定。
*   **独立 API 支持**：支持配置独立的 API（如 OpenAI、DeepSeek 等）进行后台生成，不占用主对话的上下文和模型配置。
*   **移动端适配**：优化的 UI 设计，支持手机端触摸滑动与悬浮操作。

## 📦 安装方法

1.  **前置需求**：建议安装并启用 [TavernHelper (JS-Slash-Runner)](https://github.com/n0vi028/JS-Slash-Runner) 插件以获得最佳的世界书操作体验（非强制，但推荐）。
2.  打开 SillyTavern 的 **Extensions (扩展)** 页面。
3.  点击 **Install Extension**。
4.  在 URL 栏输入本仓库地址：`[https://github.com/sisisisilviaxie-star/st-persona-weaver]`
5.  点击 **Save** 并刷新页面。

## 📖 使用简述

1.  安装后，输入框上方会出现 **魔棒图标** (<i class="fa-solid fa-wand-magic-sparkles"></i>)，点击即可打开面板。
2.  **生成**：在编辑页输入您的要求，点击生成。
3.  **润色**：选中生成结果中的某段文字，点击浮现的“修改”按钮，或直接在下方输入意见进行润色。
4.  **保存**：点击“覆盖当前人设”直接应用，或“保存至世界书”写入世界书条目。

---

<a name="english"></a>
## English

**Persona Weaver** is a native extension for SillyTavern that uses AI to help create, refine, and manage User Personas, with automatic World Info synchronization.

### ✨ Features

*   **AI Generation**: Automatically generate detailed, structured User Personas (YAML) with an AI-curated schema, from optional natural-language requirements.
*   **Smart Refinement & Diff View**: 
    *   Refine your persona with natural language instructions.
    *   **Smart Contrast**: Visually compare the original vs. refined text side-by-side, allowing you to selectively apply changes or edit directly.
*   **World Info Sync**: Automatically detects bound World Info books and allows one-click saving of your persona as an entry.
*   **Independent API**: Supports configuring a separate API (e.g., OpenAI, DeepSeek) for generation tasks, keeping your main chat context free.
*   **Mobile Friendly**: Optimized UI for touch screens and mobile devices.

### 📦 Installation

1.  **Prerequisite**: [TavernHelper (JS-Slash-Runner)](https://github.com/n0vi028/JS-Slash-Runner) is recommended for full World Info features.
2.  Open **Extensions** in SillyTavern.
3.  Click **Install Extension**.
4.  Paste the repo URL: `https://github.com/sisisisilviaxie-star/st-persona-weaver`
5.  Click **Save** and reload.

## 📄 License

MIT License
