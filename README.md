# urchin

urchin 是一个基于 Tauri + React + SQLite 的学习专注工具原型。当前阶段重点实现个人专注模式、学习记录和统计看板，先把本地使用闭环做完整，再考虑账号、同步、社交自习室等扩展能力。

## 当前功能

- 科目管理：新增、删除自定义学习科目，并为科目设置颜色。
- 专注计时：选择科目和计划时长后开始专注。
- 专注控制：支持暂停、继续、完成、放弃。
- 本地记录：每次专注结束后保存为学习记录。
- 今日统计：汇总今日专注时长、完成次数、最长专注等指标。
- 本周统计：用柱状图查看本周每天学习时长。
- 科目占比：用环形图查看今日不同科目的学习占比。
- 学习报告：生成无默认身份信息的今日学习报告卡片。
- 主题切换：支持清爽自习室、CoStudy 暖色、深色夜读三套主题。

## 技术栈

- 桌面壳：Tauri 2
- 前端：React 19 + TypeScript + Vite
- 本地数据库：SQLite，通过 `@tauri-apps/plugin-sql` 接入
- 图表：Recharts
- 图标：lucide-react
- 代码检查：ESLint

## 目录结构

```text
.
├─ src/
│  ├─ App.tsx          # 应用主界面和专注/统计交互
│  ├─ App.css          # 页面布局和组件样式
│  ├─ index.css        # 全局样式和主题变量
│  ├─ storage.ts       # SQLite / localStorage 存储封装
│  └─ types.ts         # 核心数据类型
├─ src-tauri/
│  ├─ src/lib.rs       # Tauri 插件注册入口
│  ├─ capabilities/    # Tauri 权限配置
│  └─ tauri.conf.json  # Tauri 应用配置
├─ package.json
└─ README.md
```

## 环境准备

前端浏览器预览只需要 Node.js 和 npm。

```powershell
node --version
npm --version
```

运行 Tauri 桌面端还需要 Rust 和 Cargo。安装后确认：

```powershell
rustc --version
cargo --version
```

Windows 上运行 Tauri 还需要 Microsoft C++ Build Tools / Visual Studio 生成工具，以及 WebView2 Runtime。通常新版 Windows 已经自带 WebView2。

## 安装依赖

```powershell
npm install
```

## 前端开发预览

启动 Vite 开发服务器：

```powershell
npm run dev
```

默认访问：

```text
http://localhost:5173
```

在浏览器模式下，应用会自动降级使用 `localStorage` 存储数据，方便没有 Rust 环境时先调试前端交互。

## Tauri 桌面端调试

确认 Rust/Cargo 已安装后运行：

```powershell
npm run tauri dev
```

从项目根目录运行 Tauri 命令时，Tauri 会通过 `src-tauri/dev-frontend.ps1` 自动切回项目根目录启动 Vite。开发地址固定为：

```text
http://127.0.0.1:5173
```

如果看到 Tauri 一直提示：

```text
Waiting for your frontend dev server to start on http://127.0.0.1:5173/
```

先单独检查前端服务：

```powershell
powershell -ExecutionPolicy Bypass -File src-tauri/dev-frontend.ps1
```

然后访问：

```text
http://127.0.0.1:5173
```

如果 Windows 上遇到类似下面的 MSVC 链接错误：

```text
LINK : fatal error LNK1181: 无法打开输入文件“kernel32.lib”
```

说明当前终端没有正确加载 Visual Studio / Windows SDK 的 `LIB`、`INCLUDE` 环境变量。可以改用项目内置的 Windows 启动脚本：

```powershell
npm run tauri:dev:msvc
```

这个脚本会自动查找本机最新的 MSVC 和 Windows SDK 目录，并在当前进程里补齐：

```text
PATH
LIB
INCLUDE
```

如果脚本仍然报找不到 `kernel32.lib` 或 `windows.h`，需要用 Visual Studio Installer 安装或修复：

- MSVC v143/vNext x64/x86 build tools
- Windows 10/11 SDK
- C++ CMake tools for Windows

桌面端会优先使用 SQLite 数据库：

```text
sqlite:urchin.db
```

Tauri SQL 权限配置位于：

```text
src-tauri/capabilities/default.json
```

插件注册位于：

```text
src-tauri/src/lib.rs
```

## 构建

构建前端产物：

```powershell
npm run build
```

预览前端生产构建：

```powershell
npm run preview
```

构建 Tauri 桌面应用：

```powershell
npm run tauri build
```

## 代码检查

```powershell
npm run lint
```

建议提交前至少运行：

```powershell
npm run lint
npm run build
```

如果本机已经装好 Rust/Cargo，再额外运行：

```powershell
npm run tauri dev
```

## 数据存储说明

应用启动时会尝试加载 Tauri SQLite：

```ts
Database.load('sqlite:urchin.db')
```

如果当前运行环境不是 Tauri，或者 SQL 插件不可用，会自动切换到浏览器 `localStorage`。

localStorage 使用的 key：

```text
urchin.subjects
urchin.sessions
urchin.theme
```

旧版本中的默认科目会在迁移时过滤掉。当前版本不会再自动写入默认科目，也不会展示默认身份信息。

## 主题开发

主题变量集中在：

```text
src/index.css
```

新增主题时：

1. 在 `src/index.css` 新增一组 `:root[data-theme='your-theme']` 变量。
2. 在 `src/App.tsx` 的 `THEMES` 数组里添加选项。
3. 运行 `npm run lint` 和 `npm run build` 验证。

## 后续开发方向

- 设置页：默认专注时长、休息时长、提醒音、严格模式。
- 专注事件：记录小休、溜号、按时返回等更细颗粒度数据。
- 报告导出：将学习报告导出为图片。
- 趋势统计：月度日历热力图、科目趋势、目标完成率。
- 桌面能力：系统托盘、窗口置顶、通知提醒。
- 数据同步：账号系统和云端备份。
