# DualSub - 流媒体双语字幕扩展

[English Version | 英文版](README.md)

![Version](https://img.shields.io/github/v/release/QuellaMC/DualSub.svg)
![Last Commit](https://img.shields.io/github/last-commit/QuellaMC/DualSub.svg)
![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)
![Manifest](https://img.shields.io/badge/Manifest-v3-blue.svg)

**DualSub** 是一个强大的 Chrome 扩展，通过同时显示双语字幕来增强您的流媒体观看体验。非常适合语言学习、无障碍访问，或者只是想同时享受多种语言的内容。

## 📋 目录

- [功能特性](#-功能特性)
- [支持的平台](#-支持的平台)
- [翻译服务商](#-翻译服务商)
- [安装说明](#-安装说明)
- [快速开始](#-快速开始)
- [配置设置](#-配置设置)
- [开发环境设置](#-开发环境设置)
- [架构设计](#-架构设计)
- [贡献指南](#-贡献指南)
- [测试](#-测试)
- [许可证](#-许可证)
- [更新日志](#-更新日志)

## ✨ 功能特性

### 核心功能

- **🎬 双语字幕显示**：同时显示原文和翻译字幕
- **🌐 多平台支持**：支持 Netflix 和 Disney+，具有平台特定优化
- **🔄 多种翻译服务商**：可选择 Google、Microsoft、DeepL 和 OpenAI 兼容服务
- **🎯 智能翻译**：提供商之间的自动回退和智能批处理

### 自定义选项

- **📐 灵活布局**：垂直（上/下）或水平（左/右）字幕排列
- **🎨 外观控制**：可调节字体大小、间距和显示顺序
- **⏱️ 时间精度**：通过偏移控制微调字幕同步
- **🌍 多语言界面**：界面支持 6 种语言（EN、ES、JA、KO、ZH-CN、ZH-TW）

### 高级功能

- **⚙️ 性能调优**：可配置的批处理大小和请求延迟以获得最佳性能
- **🔧 高级选项**：具有服务商特定配置的综合设置页面
- **📊 日志系统**：具有可配置日志级别的详细调试
- **🔄 官方字幕集成**：在可用时使用平台的原生字幕（Netflix）

## 🎯 支持的平台

| 平台        | 状态        | 功能                                    |
| ----------- | ----------- | --------------------------------------- |
| **Netflix** | ✅ 完全支持 | 官方字幕集成，SPA 导航检测              |
| **Disney+** | ✅ 完全支持 | M3U8 播放列表解析，视频检测             |

### 平台特定功能

- **Netflix**：增强的 SPA 导航检测，官方翻译支持
- **Disney+**：高级 M3U8 字幕提取，多种 URL 模式支持

## 🔄 翻译服务商

| 服务商                  | 类型 | 质量       | 需要设置   | 备注                         |
| ----------------------- | ---- | ---------- | ---------- | ---------------------------- |
| **DeepL 免费版**        | 免费 | ⭐⭐⭐⭐⭐ | 无         | 推荐默认选择，高质量         |
| **Google 翻译**         | 免费 | ⭐⭐⭐⭐   | 无         | 快速，广泛的语言支持         |
| **Microsoft 翻译**      | 免费 | ⭐⭐⭐⭐   | 无         | 性能良好，可靠               |
| **DeepL API**           | 付费 | ⭐⭐⭐⭐⭐ | API 密钥   | 最高质量，有使用限制         |
| **OpenAI 兼容**         | 付费 | ⭐⭐⭐⭐⭐ | API 密钥   | 支持 Gemini 模型             |

### 服务商功能

- **自动回退**：如果一个服务商失败，无缝切换到其他服务商
- **速率限制**：智能请求管理以避免 API 限制
- **批处理**：优化多个字幕片段的翻译

## 📦 安装说明

### 选项 1：手动安装（推荐用于开发）

1. **下载扩展**

    ```bash
    git clone https://github.com/QuellaMC/DualSub.git
    cd DualSub
    ```

2. **安装依赖**（用于开发）

    ```bash
    npm install
    ```

3. **在 Chrome 中加载**
    - 打开 Chrome 并导航到 `chrome://extensions`
    - 启用"开发者模式"（右上角的开关）
    - 点击"加载已解压的扩展程序"
    - 选择 `DualSub` 目录

4. **验证安装**
    - DualSub 图标应该出现在您的 Chrome 工具栏中
    - 访问 Netflix 或 Disney+ 测试功能

### 选项 2：Chrome 网上应用店（即将推出）

_扩展将在未来版本中在 Chrome 网上应用店上架。_

## 🚀 快速开始

1. **安装扩展**，按照上述说明操作
2. **访问支持的平台**（Netflix 或 Disney+）
3. **开始播放视频**，启用字幕
4. **点击工具栏中的 DualSub 图标**打开设置
5. **启用双语字幕**并选择您的目标语言
6. **享受吧！**原文和翻译字幕将同时出现

### 首次设置提示

- 从 **DeepL 免费版**服务商开始（默认），获得最佳质量
- 使用**上/下布局**以便更容易阅读
- 调整**字体大小**和**间距**以获得最佳观看效果
- 启用**隐藏官方字幕**以避免重叠

## ⚙️ 配置设置

### 弹出设置（快速访问）

点击工具栏中的 DualSub 图标以访问：

- **🔄 启用/禁用**：切换双语字幕功能
- **🌐 翻译服务商**：选择您首选的翻译服务
- **🎯 目标语言**：从 50+ 种选项中选择翻译语言
- **📐 布局选项**：上/下或左/右排列
- **🎨 外观**：字体大小、间距和显示顺序
- **⏱️ 时间**：字幕偏移调整（±10 秒）

### 高级选项页面

通过弹出窗口 → "高级设置"访问：

#### 常规设置

- **🌍 界面语言**：选择界面语言（EN、ES、JA、KO、ZH-CN、ZH-TW）
- **👁️ 隐藏官方字幕**：移除平台的原生字幕
- **📊 日志级别**：控制调试信息（关闭/错误/警告/信息/调试）

#### 翻译设置

- **🔧 服务商配置**：高级服务的 API 密钥
- **⚡ 性能调优**：批处理大小（1-10）和请求延迟（50-1000ms）
- **🔄 服务商测试**：使用前测试 API 连接

#### 服务商特定设置

- **DeepL API**：API 密钥和计划选择（免费/专业）
- **OpenAI 兼容**：API 密钥、基础 URL 和模型配置

### 配置示例

**用于语言学习：**

```
服务商：DeepL 免费版
布局：上/下
显示顺序：原文优先
字体大小：大
```

**用于性能：**

```
批处理大小：5
请求延迟：100ms
服务商：Google 翻译
```

## 🛠️ 开发环境设置

### 先决条件

- **Node.js** 18+ 和 npm
- **Google Chrome** 启用开发者模式
- **Git** 用于版本控制

### 设置说明

1. **克隆和安装**

    ```bash
    git clone https://github.com/QuellaMC/DualSub.git
    cd DualSub
    npm install
    ```

2. **开发命令**

    ```bash
    # 代码格式化
    npm run format

    # 代码检查
    npm run lint
    npm run lint:fix

    # 测试
    npm test
    npm run test:watch
    ```

3. **加载扩展进行测试**
    - 按照上述手动安装步骤
    - 更改后重新加载扩展

### 项目结构

```
DualSub/
├── content_scripts/     # 平台特定的内容脚本
├── translation_providers/ # 翻译服务实现
├── services/           # 核心服务（配置、日志）
├── popup/             # 扩展弹出界面
├── options/           # 高级设置页面
├── utils/             # 共享工具
├── test-utils/        # 测试基础设施
├── _locales/          # 国际化文件
└── icons/             # 扩展图标
```

## 🏗️ 架构设计

DualSub 使用基于几个关键设计模式的现代模块化架构：

### 核心架构

- **📐 模板方法模式**：`BaseContentScript` 提供通用功能，具有平台特定实现
- **🔌 依赖注入**：动态模块加载，提高可测试性和松耦合
- **📡 事件驱动设计**：具有基于操作路由的可扩展消息处理
- **🧹 资源管理**：全面的清理系统，防止内存泄漏

### 关键组件

- **内容脚本**：扩展 `BaseContentScript` 的平台特定实现
- **翻译服务商**：具有自动回退的模块化翻译服务
- **配置服务**：具有验证的集中设置管理
- **日志系统**：具有可配置级别的跨上下文日志记录

有关详细的技术文档，请参阅：

- [架构概述](content_scripts/ARCHITECTURE.md)
- [API 参考](content_scripts/API_REFERENCE.md)
- [平台实现指南](content_scripts/PLATFORM_IMPLEMENTATION_GUIDE.md)

## 🤝 贡献指南

我们欢迎贡献！请遵循以下指导原则：

### 代码标准

- **ESLint + Prettier**：代码必须通过代码检查和格式化检查
- **ES 模块**：使用现代 JavaScript 模块语法
- **测试**：所有新功能都需要全面的测试
- **文档**：为更改更新相关文档

### 开发工作流程

1. **Fork** 仓库
2. **创建**功能分支（`git checkout -b feature/amazing-feature`）
3. **编写**更改的测试
4. **确保**所有测试通过（`npm test`）
5. **格式化**代码（`npm run format`）
6. **检查**代码（`npm run lint:fix`）
7. **提交**更改（`git commit -m 'Add amazing feature'`）
8. **推送**到分支（`git push origin feature/amazing-feature`）
9. **打开** Pull Request

### 添加新功能

#### 新翻译服务商

1. 在 `translation_providers/` 目录中创建服务商
2. 实现 `async function translate(text, sourceLang, targetLang)`
3. 添加到 `background.js` 服务商对象
4. 更新 `popup/popup.js` 和 `options/options.js`
5. 添加全面的测试

#### 新流媒体平台

1. 扩展 `BaseContentScript` 类
2. 实现所需的抽象方法
3. 创建平台特定配置
4. 更新 `manifest.json` 内容脚本
5. 添加平台测试

### 代码审查流程

- 所有提交都需要审查
- 测试必须通过 CI/CD 管道
- 必须更新文档
- 破坏性更改需要讨论

## 🧪 测试

DualSub 包含一个全面的测试框架：

### 运行测试

```bash
# 运行所有测试
npm test

# 开发的监视模式
npm run test:watch

# 运行特定测试文件
npm test -- background.test.js

# 运行带覆盖率的测试
npm test -- --coverage
```

### 测试结构

- **单元测试**：单个组件测试
- **集成测试**：跨组件功能
- **模拟基础设施**：Chrome API 和 DOM 模拟
- **测试工具**：共享测试助手和固定装置

### 测试指导原则

- **覆盖率**：目标 >80% 代码覆盖率
- **隔离**：测试不应相互依赖
- **模拟**：为 Chrome API 使用提供的模拟
- **断言**：清晰、描述性的测试断言

## 📄 许可证

本项目根据 **知识共享署名-非商业性使用-相同方式共享 4.0 国际许可协议（CC BY-NC-SA 4.0）** 获得许可。

[![CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/88x31.png)](http://creativecommons.org/licenses/by-nc-sa/4.0/)

### 许可证摘要

- ✅ **共享**：复制和重新分发材料
- ✅ **改编**：重新混合、转换和基于材料构建
- ❌ **商业用途**：不允许
- 📝 **署名**：必须给予适当的信用
- 🔄 **相同方式共享**：必须在相同许可证下分发

有关完整的许可证条款，请参阅 [LICENSE](LICENSE) 文件。

## 📋 更新日志

### 版本 1.5.0（当前）

- 🚀 实现了通用批量翻译系统以提高性能
- ⚡ 添加了服务商特定的批处理大小优化（API 调用减少 80-90%）
- 🔧 通过智能批处理和分隔符方法增强翻译效率
- 📊 通过可配置的批处理大小和并发处理改进字幕处理

### 版本 1.4.0

- ✨ 添加了 Netflix 支持和官方字幕集成
- 🔄 实现了具有回退功能的多个翻译服务商
- 🌐 添加了多语言界面支持（6 种语言）
- ⚙️ 引入了高级选项页面
- 🏗️ 使用模板方法模式重构架构
- 🧪 添加了全面的测试框架
- 📊 实现了可配置的日志系统
- 🔧 增强了配置管理

### 以前的版本

_有关详细的版本历史，请参阅 [GitHub 发布](https://github.com/QuellaMC/DualSub/releases)_

---

## 📞 支持与社区

- **🐛 错误报告**：[GitHub Issues](https://github.com/QuellaMC/DualSub/issues)
- **💡 功能请求**：[GitHub Discussions](https://github.com/QuellaMC/DualSub/discussions)
- **📖 文档**：[Wiki](https://github.com/QuellaMC/DualSub/wiki)

---

**⚠️ 免责声明**：此扩展与 Netflix、Disney+ 或任何流媒体平台没有官方关联。所有商标均属于其各自所有者。
