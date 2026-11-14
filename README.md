# MiniTune

小窗口 MP3 播放器（Windows 11 风格，360×580，可缩成一条迷你播放条，可隐藏到托盘）。

- **本地音乐**：添加文件夹即可，自动读取歌手 / 专辑信息
- **在线免费音乐**：后台爬虫持续、逐层深入地寻找免费音乐（Internet Archive 的 CC / 公共领域 / 乐队授权录音、Wikimedia Commons，以及你自己添加的网站），只记录地址，**不会自动下载**
- **保证能播放**：每个地址先验证再显示，后台定期复查，失效的自动撤下
- **重名只显示最好的**：找到更高音质的版本会自动替换低音质的
- **排序**：按歌手姓氏、姓名、专辑、歌名（中文按拼音，与英文混排）
- **歌单**：我喜欢、自建歌单，以及自动分类（中文 / 英文 / 歌曲 / 纯音乐 / 经典 / 已下载）
- **搜索**：敲第一个字母就出结果，支持拼音首字母（`zjl` → 周杰伦）；回车到网上搜索
- **循环**：列表循环 / 单曲循环 / 随机
- **下载**：点歌曲上的下载按钮，保存到本机「音乐/MiniTune」并上传到 GitHub
- **多电脑同步**：歌单、歌曲地址、下载的歌曲都存在本仓库的 `userdata` 分支，每台电脑内容一致

## 安装

到 [Releases](../../releases) 下载安装程序：

| 电脑 | 文件 |
| --- | --- |
| 普通 Intel / AMD 电脑（x86 64 位） | `MiniTune-Setup-版本号-x64.exe` |
| ARM 电脑（骁龙等） | `MiniTune-Setup-版本号-arm64.exe` |

## 多电脑同步（每台电脑做一次）

1. 打开 <https://github.com/settings/personal-access-tokens/new>，Repository access 选 **Only select repositories → 本仓库**，Permissions 里把 **Contents** 设为 **Read and write**，生成令牌
2. 在 MiniTune 里点右上角设置 → GitHub 同步 → 粘贴令牌 → 保存

令牌用 Windows 凭据加密后只存在本机，不会写进仓库。GitHub 已不支持用账号密码访问接口，所以用令牌代替密码。

## 快捷键

| 操作 | 按键 |
| --- | --- |
| 显示 / 隐藏窗口 | `Ctrl+Alt+M`（或点托盘图标） |
| 播放 / 暂停 | 空格 |
| 上一首 / 下一首 | `Ctrl+←` / `Ctrl+→` |
| 搜索 | 直接打字 |

## 开发

```
npm install
npm start        # 运行
npm test         # 逻辑测试
npm run dist:x64 # 在 Windows 上打包安装程序
```
