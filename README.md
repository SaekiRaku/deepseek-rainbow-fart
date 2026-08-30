# DeepSeek Rainbow Fart 🌈

一个通过语音夸你提示词写的牛逼的 Deepseek Harness 插件。当你使用 DeepSeek Harness WebUI 发送消息后，插件会基于你的内容生成夸赞你的话，并通过 TTS 合成并播放声音。

> 📖 在线文档：[saekiraku.github.io/deepseek-rainbow-fart](https://saekiraku.github.io/deepseek-rainbow-fart/)

> 感谢我的好朋友 [@JustKowalski](https://github.com/JustKowalski) 为我提供 TTS 技术指导与内置音色

> 致敬那些仍在手写代码的程序员，也许你会感兴趣我之前的 VSCode 彩虹屁插件：[vscode-rainbow-fart](https://github.com/SaekiRaku/vscode-rainbow-fart)

## 注意

- 生成彩虹屁会少量消耗你当前配置的供应商的模型的 Token
- TTS 为本地离线合成。根据设备性能，合成音频可能较慢。
- 本项目尽可能的简化了插件安装过程，因此在某些技术选型上并不是最优，只是最简单。
- 插件仅在 M 系列芯片的 MacBook 下测试过，其他环境未经验证。

## 前置要求

- 已安装 Node.js 和 npm
- 已安装 DeepSeek Harness，并至少启动过一次（`npx @deepseek-ai/dsh web`）
- 下载插件：[百度网盘](https://pan.baidu.com/s/5eHUyVV7OZuE_iICCpr1Qnw#list/path=%2Fdeepseek-rainbow-fart)

## 安装方式

> 你可以将以下内容当做提示词发送给 AI

1. 解压压缩包：`${填入文件路径，如果未提供则向用户询问}`。
2. 进入解压目录，用 Node 执行标准 dsh bundle 安装：
   ```bash
   cd deepseek-rainbow-fart
   node install.js
   ```

安装器默认使用 `~/.dsh`，也可以通过 `node install.js <DSH_HOME>` 指定其他 Harness 主目录。如果 `profiles/web` 尚未初始化，请先运行一次 `npx @deepseek-ai/dsh web`。安装过程只使用 Node.js 自带能力，不要求 pnpm 或 bun。

## 使用方式

1. 启动 Harness：`npx @deepseek-ai/dsh web`，并点击页面的任意位置（为了使浏览器音频播放权限激活）
2. 确认设备音量，然后开始聊天（比如：`天空为什么是蓝色的？`）
3. 模型完成整轮回复后，聊天中会出现 Rainbow Fart 语音条并自动播放；语音条支持暂停、调整进度和重播。您也可以看到 `Rainbow Fart` 的配置页签。

语音资源仅保留在当前 Harness 进程中：刷新页面后仍可重播，重启 Harness 后历史语音条会显示语音已失效。

## 开发方式（bun）

开发阶段使用 bun 构建并把开发环境代码自动应用到 dsh 的 `web` profile 中：

```bash
bun run dev
# 或指定其他 profile：
bash scripts/dev.sh ~/.dsh/profiles/headless
```

`dev` 会依次：构建 `packages/core`（node + client 两个部分）→ 生成本地标准 dsh
bundle tarball 并通过 `dsh plugin --profile web add` 安装 → 用 `bunx @deepseek-ai/dsh web`
启动 Web UI。插件注册由 bundle 的 `dsh.bundle` manifest 管理，不再直接修改 profile
的 `cordis.patch.yml`。
修改源码后重新运行 `bun run dev` 即可生效。

其他命令：

```bash
bun install        # 安装依赖（生成 bun.lock）
bun run build:core # 仅构建 core 包
bun run build      # 当前平台快速打包
bun run release    # 跨平台发布打包
```

## 卸载方式

在解压目录里执行：

```bash
node install.js --uninstall
```

安装器会移除插件文件和 profile 中对应的 bundle 注册，不会修改 `cordis.patch.yml`。

## 贡献

本仓库仅为娱乐项目，纯愿望编程不考虑可维护性，随缘处理 Issue / Pull Request。可随意 Fork 自行增加功能。

## License

基于 MIT 开源。

仓库中的音频采样由真人录音，并且根据 MIT 被授权人义务，在此明确：对于仓库中的音频采样资源，您有标明资源作者、链接、许可的义务。

内置音色列表：

- cyy: [@JustKowalski](https://github.com/JustKowalski)（另感谢为我提供 TTS 技术指导）

## 个人广告

本人独立开发创业中，欢迎试用我开发的其他 APP：[news.qiapp.cc](https://news.qiapp.cc/)
