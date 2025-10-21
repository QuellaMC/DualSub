# 安装说明

### 环境要求

- Google Chrome 或其它基于 Chromium 的浏览器（建议最新版本）
- 网络连接（用于翻译与 AI 上下文）
- 开发用途：需要 Node.js 18+ 与 npm

---

## 选项一：Chrome 商店安装（推荐）

1. 打开扩展页面： [Chrome 商店](https://chromewebstore.google.com/detail/dualsub/lnkcpcbpjbidpjdjnmjdllpkgpocaikj)
2. 点击“添加至 Chrome” → “添加扩展程序”
3. 可选：点击工具栏拼图图标，将 DualSub 固定至工具栏以便快速访问

### 验证

1. 访问 Netflix 或 Disney+
2. 播放任意视频并开启字幕
3. 点击 DualSub 图标 → 启用双语字幕并选择目标语言

### 更新

- 由 Chrome 商店自动管理
- 可在 `chrome://extensions` → DualSub 中查看已安装版本

### 卸载 / 禁用

- 打开 `chrome://extensions`
- 关闭开关可禁用，点击“移除”可卸载

---

## 选项二：从 GitHub 发布版本安装（推荐手动安装）

1. 下载最新版本
    - 访问 [GitHub Releases](https://github.com/QuellaMC/DualSub/releases)
    - 下载最新的 `dualsub-v*.zip` 文件
    - 解压 ZIP 文件到文件夹

2. 在 Chrome 中加载已解压的扩展
    - 打开 `chrome://extensions`
    - 开启"开发者模式"（右上角）
    - 点击"加载已解压的扩展程序"，选择解压后的文件夹

3. 验证是否生效
    - 访问 Netflix 或 Disney+
    - 开启字幕后点击 DualSub，启用双语字幕

---

## 选项三：开发环境配置（适合贡献者和开发者）

1. 获取源码
    - 使用 Git 克隆：
        ```bash
        git clone https://github.com/QuellaMC/DualSub.git
        cd DualSub
        ```

2. 安装依赖

    ```bash
    npm install
    ```

3. 构建扩展
    
    扩展使用 React 开发，使用前需要构建：
    
    ```bash
    npm run build
    ```
    
    这将创建 `dist/` 文件夹，其中包含编译后的扩展。
    
    开发模式下自动重新构建：
    
    ```bash
    npm run dev
    ```

4. 在 Chrome 中加载已解压的扩展
    - 打开 `chrome://extensions`
    - 开启"开发者模式"（右上角）
    - 点击"加载已解压的扩展程序"，选择 **`dist/`** 文件夹（不是项目根目录！）

5. 验证是否生效
    - 访问 Netflix 或 Disney+
    - 开启字幕后点击 DualSub，启用双语字幕

6. 开发工作流程
    - 修改 `popup/`、`options/` 等源文件
    - 运行 `npm run dev` 实现修改后自动重新构建
    - 在 `chrome://extensions` 中点击 DualSub 卡片的刷新按钮重新加载
    - 测试您的更改

7. 手动更新（开发安装）
    - 拉取最新代码：
        ```bash
        git pull
        npm install  # 如果依赖项发生变化
        npm run build
        ```
    - 在 `chrome://extensions` 中点击 DualSub 卡片的刷新按钮

---

## 常见问题排查

- 扩展不可见：在 `chrome://extensions` 确认已启用，并可选择固定到工具栏
- "无法加载 manifest"：
  - GitHub 发布版：确保已解压 ZIP 并选择解压后的文件夹
  - 开发版：确保选择的是 `dist/` 文件夹（不是项目根目录！）并且已运行 `npm run build`
- 构建错误：确保已安装 Node.js 18+，并在 `npm run build` 之前运行 `npm install`
- 无字幕可用：确认平台本身提供字幕并在播放器中已开启
- AI 上下文无响应：在高级设置中配置 API 密钥与模型；检查速率限制与网络
- 翻译服务异常：尝试更换服务商，或在高级设置中调小批处理、增大请求延迟

如仍有问题，请提交 Issue： [GitHub Issues](https://github.com/QuellaMC/DualSub/issues)
