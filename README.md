# 帧间 · Local Frame

Windows 本地媒体浏览器。读取一个或多个指定文件夹，浏览图片、播放视频、查看纯文本；电脑与手机使用同一个网页。原生 HTML/CSS/JavaScript + Express，无前端构建、数据库、Docker 或外部 CDN。依赖安装完成后，运行不需要外网。

只读访问源文件。应用不提供上传、删除、移动、重命名或修改源文件的 API。缩略图、媒体信息与日志独立保存。PRD 原文保留在 `Codex_Windows_Local_Media_Browser_PRD.md`；逐项验收与尚未验证的条件见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 1. Windows 安装

在 PowerShell 中操作。项目目录可以包含中文和空格。

1. 从 [Node.js 官方下载页](https://nodejs.org/en/download) 安装维护中的 LTS（推荐 Node.js 26 LTS，也兼容 24 LTS），保留 npm 和 Add to PATH。重新打开 PowerShell。
2. 从 [FFmpeg 官方下载指引](https://ffmpeg.org/download.html#build-windows) 选择 Windows 构建，手动下载并解压。确认 `bin` 下同时有 `ffmpeg.exe` 与 `ffprobe.exe`。
3. 在「系统属性 → 高级 → 环境变量 → 用户 Path」添加 FFmpeg 的 `bin`，例如 `C:\Tools\ffmpeg\bin`。重新打开 PowerShell，验证：

```powershell
node --version
npm --version
ffmpeg -version
ffprobe -version
```

服务不一定继承交互账户的用户 PATH。后台部署推荐在配置中写 FFmpeg/ffprobe 的绝对可执行文件路径，避免服务账户找不到它们。

进入项目，安装锁定的依赖：

```powershell
Set-Location 'D:\your-project\localwebsite'
npm ci
Copy-Item .\config.example.json .\config.json
notepad .\config.json
```

正式运行不需要浏览器测试依赖，可用 `npm ci --omit=dev`。首次安装需要联网；之后启动和媒体访问完全离线。若 PowerShell 禁止执行 `npm.ps1`，使用 `npm.cmd ci`、`npm.cmd start`，无需降低全局执行策略。

直接运行 `npm start` 且没有配置文件时，会以 **127.0.0.1:8090、空媒体库** 启动并提示配置；不会擅自扫描磁盘。

## 2. 配置媒体目录

编辑 `config.json`（JSON 中 Windows 反斜线写成 `\\`，也可写 `D:/Videos`）：

```json
{
  "host": "127.0.0.1",
  "port": 8090,
  "lan": { "enabled": false, "passwordHash": "", "sessionHours": 12 },
  "roots": [
    { "id": "videos", "name": "视频库", "path": "D:\\Videos" },
    { "id": "photos", "name": "照片库", "path": "E:\\Photos" }
  ],
  "cacheDir": ".cache",
  "ffmpegPath": "C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe",
  "ffprobePath": "C:\\Tools\\ffmpeg\\bin\\ffprobe.exe",
  "thumbnail": { "width": 320, "concurrency": 2, "maxQueue": 128, "timeoutMs": 20000, "maxCacheMB": 1024 },
  "textPreviewBytes": 1048576,
  "directoryCacheMs": 2000,
  "maxStreams": 32
}
```

`id` 唯一，只能含字母、数字、`_`、`-`；`name` 是显示名称；`path` 是真实存在且可读取的目录。相对路径以**配置文件所在目录**为基准，不依赖启动工作目录。端口范围 1–65535。修改配置后重启。缓存目录必须在所有媒体根目录之外，也不能包含媒体根目录；真实路径校验同样防止缓存 Junction 重叠。不要将系统盘或整个项目目录配置为媒体库。

```powershell
npm start
# 浏览器打开 http://localhost:8090
# 停止：Ctrl+C
```

可显式选择其他配置：

```powershell
node .\server.js --config .\my-config.json
# 或：
$env:MEDIA_CONFIG = 'D:\config\media.json'
npm start
```

根目录没有权限或已离线时，首页标记不可用，点击后显示原因；不会导致服务退出。更改盘符后需更新配置。网络共享建议用 UNC 路径，服务账户必须有共享与 NTFS 读取权限，不能依赖登录用户映射的网络盘。

## 3. 可选演示

不想先配置私人媒体时：

```powershell
npm run demo
npm run start:demo
```

脚本只写项目 `.demo/` 与 `config.demo.json`：生成两个真实测试根目录、几张示例图片、中文文本与空目录；FFmpeg 可用时还生成 90 秒 H.264/AAC 测试视频。它不读取、覆盖 `config.json` 或扫描私人媒体。也可临时设置 `FFMPEG_PATH` / `FFPROBE_PATH` 指向便携工具后再生成。

## 4. 使用与格式兼容

- 首页面包屑与侧栏选择媒体库；文件夹优先、名称自然排序；支持上一级、网格/列表、类型与当前文件夹文件名筛选。`/` 聚焦搜索。刷新按钮强制重新读取目录。
- 图片支持 JPEG、PNG、WEBP、GIF、AVIF、BMP、ICO 的识别和浏览器预览。缩略图为静态 WEBP，GIF 原图预览仍可动画。图片预览提供上一张、下一张、缩小、放大与适应窗口；放大后可滚动。浏览器或 Sharp 不支持的文件显示占位或下载提示。
- TXT、MD、JSON、LOG、CSV、SRT、YAML/YML、VTT、INI 仅按纯文本展示，HTML/JS 不执行。优先 UTF-8，识别 UTF-16 BOM，UTF-8 无法解码时回退 GB18030。不是通用编码探测器；无 BOM UTF-16/Big5 可能需另存 UTF-8。默认最多读取前 1 MiB，超过时明确提示截断，可下载全文。
- MP4/M4V、MOV、WEBM、MKV、AVI、OGV 可识别。**推荐 MP4 + H.264/AAC**；容器扩展名并不保证浏览器支持其内部编码。MKV、AVI、HEVC 是否可播取决于浏览器、操作系统和解码器。失败时显示明确提示，可下载文件，再通过 Windows「打开方式」选择已安装的 VLC、mpv 等播放器；浏览器不能可靠地直接启动任意本机程序。本项目不实时转码。
- 未知格式显示文件图标，可下载；SVG、HTML 等主动内容不作为源站页面直接预览。

视频控制：播放/暂停、进度条、当前/总时间、静音/音量、全屏、0.5/1/1.25/1.5/2 倍速、当前目录上一条/下一条。不会自动播放下一条。部分手机不允许网页设置系统音量，应使用物理音量键；iPhone 如只能原生视频全屏，会使用系统播放控件。

| 操作 | 行为 |
| --- | --- |
| 空格 | 播放/暂停；输入框、滑块、选择框聚焦时保留原生键盘行为 |
| ← / → | −10 / +10 秒 |
| Shift + ← / → | −30 / +30 秒 |
| 窗口模式视频左侧 / 右侧双击或双击触屏 | −10 / +10 秒；连续同侧点击继续累计并显示反馈 |
| 窗口模式中间点击或播放按钮 | 播放/暂停 |
| 全屏单击画面 | 显示/隐藏半透明控制条；不改变播放状态，约 3 秒无操作自动隐藏 |
| 全屏双击画面（含触屏） | 播放/暂停；横滑、键盘和控制条跳转仍可用 |
| 横向滑动视频画面 / 鼠标横拖 | 超过 24px 且横向明显大于纵向才识别；12px 对应 1 秒，最多 ±60 秒；滑动时预览，松手才定位 |
| Esc | 退出全屏，或关闭预览 |

阈值集中在 `public/gestures.js`。窗口模式视频边缘单击延迟 320ms，以区分双击；中间点击即时响应。全屏单击同样等待双击判定，控制条默认隐藏，以紧凑浮层覆盖画面，不挤压视频；Tab 可调出控制条供键盘操作。滑动不绑定进度条或按钮。触屏左右各 24px 保留系统边缘手势，纵向滑动和 pointercancel 不提交跳转。系统与浏览器对手势的优先级仍需在真实手机验收。

播放位置只保存在当前浏览器 localStorage（最多 200 个视频），同一根目录 id 和相对文件名作为标识；超过 3 秒才续播，最后 10 秒或 97% 之后从头开始。清理浏览器数据、不同设备、隐私窗口或更名会影响记录；存储不可用不阻止播放。

## 5. 缓存、性能与边界

目录列表无需等待缩略图。前端图片使用 `loading=lazy`，列表重新筛选/切换视图不请求目录；目录服务端缓存默认 2 秒（最多 64 个目录），检查目录修改时间，刷新按钮可绕过缓存。只读当前层，不递归扫描磁盘；列表 stat/realpath 并发最多 16。

图片用 Sharp 生成宽 320px、等比例、自动旋转的 WEBP，限制输入 1 亿像素、Sharp 内存缓存 32MB。视频先用 ffprobe 读取时长，再用 FFmpeg 参数数组截取单帧，不启动 shell：超过 3 分钟时取 3:01 附近画面（刚超过 3 分钟时取 3:00 与结尾之间），不超过 3 分钟则取首帧。读取时长或截取失败显示占位。缓存版本已更新，旧封面自动失效，无需手动清缓存。ffprobe 还返回分辨率及编码。两者共用限制为 2 的生成队列，同一任务去重，最多排队 128 个任务，超载返回 503，失败负缓存 60 秒。单个处理进程默认 20 秒超时；不兼容或损坏文件用图标占位，不阻塞列表。

文件夹只看当前一层，优先 `cover.jpg` / `cover.png`，再按自然顺序尝试图片/视频（最多 12 个候选，防止大量损坏文件拖住请求），否则显示文件夹图标。封面不会自动递归到孙目录。

磁盘缓存键含真实文件路径的 SHA-256、文件大小、mtime/ctime、缩略图宽度与版本。返回 ETag 与 `private, no-cache`，浏览器每次访问重新验证，修改源文件会生成新缓存。缓存默认上限 1 GiB，启动时及每 32 次生成后清理最旧缓存，因此允许短暂超出软上限；旧版本最终会被回收。metadata JSON 同样缓存。停服后可手动清空 `.cache` 中的内容，下次重建。缓存目录仅供应用账户写入。

媒体通过文件句柄的 64 KiB 流读取，最多同时 32 个流；支持单段 Range 的首尾、开放结束和后缀形式，206、416、Content-Range、Accept-Ranges、If-Range ETag。多段或无效 Range 返回 416。HEAD 按 HTTP 语义忽略 Range，返回完整文件长度但无响应体；空文件 Range 返回 416。不会把整个视频读入内存。无 Range 时仍以流返回 200。文本读取单独限制为 1–4 MiB 可配置上限。

## 6. 手机与局域网访问（可选）

默认只监听 `127.0.0.1`，无需登录。必须显式配置以下条件才可监听 `0.0.0.0`：

1. 运行 `npm run password`，交互输入至少 12 位密码（不回显）。复制输出的 scrypt 哈希，**不要将明文密码放进前端或代码**。
2. 在 `config.json` 中同时设置：

```json
"host": "0.0.0.0",
"lan": { "enabled": true, "passwordHash": "scrypt$此处粘贴完整输出", "sessionHours": 12 }
```

3. 重启服务，手机和电脑连接同一可信局域网。通过 `ipconfig` 查看电脑 IPv4，例如手机访问 `http://192.168.1.20:8090`。
4. 如防火墙阻止，只在**管理员 PowerShell**为专用网络和本地子网创建规则（自行按实际端口修改）：

```powershell
New-NetFirewallRule -DisplayName 'LocalFrame LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8090 -Profile Private -RemoteAddress LocalSubnet
# 关闭局域网并恢复 host 后，可移除规则：
Remove-NetFirewallRule -DisplayName 'LocalFrame LAN'
```

局域网所有媒体 API（包括缩略图、下载和流）均要求 HttpOnly/SameSite=Strict 登录 cookie。会话存在内存中，重启失效，有效期默认 12 小时。单 IP 15 分钟最多 8 次失败；成功后重置。退出登录立即撤销会话。不做多用户权限系统。

**局域网 HTTP 不加密密码或媒体。只在可信专用网络使用，不向公网暴露，不配置路由器端口映射，避免不可信 Wi-Fi。** 不需要手机时保持默认本地模式。

服务端检查相对路径、盘符/ADS、目录边界和 realpath，拒绝向根目录之外的 Junction/符号链接；不向浏览器返回磁盘绝对路径。还拒绝跨站请求、限制本地模式的 Host，阻止常见 DNS rebinding。信任本机管理员与可写媒体目录的账户；不是针对本地攻击者在校验和打开文件之间反复替换链接的隔离沙箱。服务账户只应能读取源目录、写入独立缓存/日志。

## 7. NSSM 后台服务、开机自启与卸载

脚本**不下载、不安装 NSSM**。从 [NSSM 官方下载页](https://nssm.cc/download) 手动下载并解压适用 Windows 版本的构建。先在控制台完成 `npm start` 和媒体测试，再停止控制台进程，避免端口冲突。

管理员 PowerShell（路径替换为实际值）：

```powershell
Set-Location 'D:\your-project\localwebsite'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 -NssmPath 'C:\Tools\nssm\win64\nssm.exe' -NodePath 'C:\Program Files\nodejs\node.exe'
```

该调用只对本次脚本设置执行策略，不修改系统策略。脚本检测 NSSM/Node、配置和已存在服务，不覆盖现有服务，注册后**尚不启动**，便于先检查账户权限：

- Application：Node 的绝对路径；AppParameters：带引号的 `server.js` 绝对路径；AppDirectory：项目目录。
- 默认配置文件为项目 `config.json`。服务读取配置和 node_modules，源媒体只需读取，缓存与 logs 需要写入。
- 服务名默认 `LocalFrame`；启动类型 `SERVICE_AUTO_START`。NSSM 默认使用系统账户，建议通过 `nssm edit LocalFrame` → Log on 配置专用低权限账户并授予所需目录权限。网络共享须使用具备网络凭据的账户；用户映射盘符可能不可见。
- 标准输出 `logs/stdout.log`，错误 `logs/stderr.log`；启用在线日志轮转，10 MiB 轮转。
- 程序异常退出后等待 5 秒重启；停止时先发送控制台停止信号，给应用 5 秒关闭队列/FFmpeg/连接，必要时 NSSM 终止进程树。

配置完成后：

```powershell
Start-Service LocalFrame
Get-Service LocalFrame
Get-Content .\logs\stdout.log -Tail 50 -Wait
# 单独查看错误：
Get-Content .\logs\stderr.log -Tail 100
# 修改 config.json 后：
Restart-Service LocalFrame
# 停止：
Stop-Service LocalFrame
```

卸载（保留项目、配置、缓存、日志和所有媒体源文件）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-service.ps1 -NssmPath 'C:\Tools\nssm\win64\nssm.exe'
Get-Service LocalFrame -ErrorAction SilentlyContinue
```

自定义名称时安装、停止和卸载都使用相同 `-ServiceName`。也可手动 `nssm install LocalFrame` 填上列设置，停止用 `nssm stop LocalFrame`，卸载用 `nssm remove LocalFrame confirm`。安装脚本执行部分失败时，先查看 `nssm edit LocalFrame`，必要时用卸载脚本移除后重新注册。

本次仅检查了脚本语法与配置内容，**没有修改本机服务、账户或防火墙，没有实测 NSSM、重启开机或长时间后台驻留**；具体验收步骤见验收文件。

## 8. 自动化测试

```powershell
npm ci
npm run check
npm test
npm run test:browser
```

`npm test` 使用 Node 内置测试运行器，创建隔离的临时两个真实目录和缓存，验证越界、Windows Junction、中文文件名、空目录、文本安全/编码/截断、206/416/HEAD/If-Range、缩略图失效/磁盘复用、鉴权、队列和手势计算。包含 5 GiB 临时扩展文件的尾部 Range 测试，测试结束删除；在不支持稀疏扩展的文件系统可能短暂占用对应磁盘空间。建议至少预留 6 GiB 临时空间。不会读取配置中的私人文件。

真实视频测试需要 FFmpeg 与 ffprobe；可配置以下环境变量（测试专用，不替代正式配置）：

```powershell
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
$env:FFPROBE_PATH = 'C:\Tools\ffmpeg\bin\ffprobe.exe'
npm test
npm run test:browser
```

浏览器测试用 Playwright 驱动**已安装的 Chrome 与 Edge**（`channel: chrome / msedge`），无需另下 Chromium，覆盖导航、筛选、视图、图片放大/切换、文本不执行、真实视频播放、键盘、双击累计、进度条、鼠标拖动松手定位、速度/静音/全屏、续播、上一条/下一条、解码失败提示与手机视口/CDP 真实触摸事件。截图写入 `test-results/`。如只装了一个浏览器，设置 `$env:BROWSER_CHANNELS = 'msedge'` 或 `'chrome'`；也可用 `BROWSER_PATH` 指定对应可执行文件。

FFmpeg 不可用时，后端真实视频用例明确标记跳过；浏览器用例会记录未执行视频部分。**有跳过不能视为完成视频验收。** 浏览器缺失直接报错，不伪装通过。受限制执行器可能拦截 127.0.0.1 或 Junction，请在正常 Windows PowerShell 运行。

## 9. 排错

| 情况 | 处理 |
| --- | --- |
| 端口被占用 | 停止旧控制台/服务，或修改 port；本项目不会自动终止其他进程 |
| 视频封面为占位 | 检查 FFmpeg/ffprobe 路径和文件，确保服务账户能执行工具；失败会缓存 60 秒，重试需等待或重启 |
| 文件未立即更新 | 点击刷新；目录列表缓存最多 2 秒；缩略图会重新验证文件版本 |
| 图片解码失败 | 检查损坏、支持格式或像素上限；下载原文件用本机应用打开 |
| MP4 无画面/无声音 | 检查真实视频/音频编码；建议 H.264/AAC，扩展名不能保证兼容 |
| 手机不能调音量 | 使用设备音量键，属于部分移动浏览器限制 |
| 手机访问不了 | 核对 lan.enabled、host、哈希、IPv4、同一网络、专用网络防火墙规则 |
| 服务看不到目录 | 检查服务登录账户、NTFS/共享权限，避免仅对交互用户可见的映射盘 |
| 队列繁忙返回 503 | 等待后刷新；默认并发 2，避免为速度盲目提高进程数 |
| JSON 配置错误 | 校验逗号、引号与路径转义；服务启动日志给出配置错误 |

## 10. 项目与维护

```text
server.js                 启动、信号停止
server/                   配置、授权路径、文件/Range、缓存队列、鉴权
public/                   离线原生前端、画廊、播放器和集中手势参数
scripts/                  检查、演示、密码哈希、NSSM 安装/卸载
tests/                    后端集成/逻辑测试、Chrome/Edge 端到端测试
config.example.json       配置模板（私有 config.json 不入版本库）
package-lock.json         锁定全部传递依赖，部署使用 npm ci
ACCEPTANCE.md             PRD 对照、实际测试与剩余人工验收
```

直接依赖：Express **5.3.0**、Sharp **0.35.5**、iconv-lite **0.7.3**；开发依赖 Playwright **1.65.1**。Node 24/26 LTS。首次依赖安装后无需编译或构建前端。定期更新维护中的 Node LTS 与依赖补丁，更新锁文件后重跑测试。

API：`GET /api/roots`、`/api/list`、`/api/thumbnail`、`/api/stream`、`/api/text`、`/api/download`、`/api/metadata` 接受 `root` 与 `path` 相对路径参数；`list` 支持 `refresh=1`。`GET /api/session`、`POST /api/login`、`POST /api/logout` 管理局域网会话，`GET /api/status` 检查媒体工具。文件 API 对未授权、越界、损坏或资源拥塞返回结构化错误，不返回真实磁盘路径。
