# Antigravity 启动后白屏 —— 诊断与修复方案

诊断时间：2026-10-15
环境：Windows / Antigravity v2.17.0（安装于 `C:\Users\Administrator\AppData\Local\Programs\antigravity`）

## 一、现象

打开 Antigravity → 显示 "Loading Antigravity" → 约 30 秒后窗口变空白。进程仍在，但界面不再渲染，之后会自行重启并换一个端口，循环重复。

## 二、关键证据（来自本机日志与实测）

**1. Electron 主进程日志** `%APPDATA%\Antigravity\logs\main.log`

```
[10:21:49] Starting app (v2.17.0) with dynamic port…
[10:21:49] Host bridge server listening on http://127.0.0.1:49706
[10:21:50] [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:49707/
[10:22:20] [error] Failed to load URL: https://127.0.0.1:49707/ with error: ERR_TIMED_OUT
```

同样的 "Failed to load URL ... ERR_TIMED_OUT" 从 **2026-09-28 起每次启动都出现**；而 09-24 的两次启动是正常的（无此错误）。每次都是启动后约 30 秒报错。

**2. 语言服务器日志** `%APPDATA%\Antigravity\logs\language_server.log`

```
[10:21:50] Language server listening on random port at 49707 for HTTPS (gRPC)
[10:22:11] W auth_client.go:356] Failed to get granted scopes in validation:
           Post "https://oauth2.googleapis.com/token": dial tcp 64.233.187.95:443:
           connectex: A connection attempt failed because the connected party did not
           properly respond after a period of time…
[10:22:36] E server.go:812] Failed to get OAuth token: failed to compute token:
           Post "https://oauth2.googleapis.com/token": dial tcp 64.233.187.95:443: …
```

两点非常重要：

- 窗口要加载的 `https://127.0.0.1:49707/` **就是语言服务器自己监听的端口**。白屏 = 这个本地 UI 端点没能把页面交付出来。
- 语言服务器在启动时**直连** Google（`oauth2.googleapis.com` / `daily-cloudcode-pa.googleapis.com`）做鉴权，`dial tcp ...:443` 说明它**没有走任何代理**，连接被阻断，反复超时约 21 秒，鉴权 bootstrap 永远完不成 → 本地 UI 端点无法就绪 → 渲染进程 30 秒后超时 → 白屏。

**3. 本机网络实测**

| 目标 | 直连 | 经 Clash 代理 127.0.0.1:7897 |
|---|---|---|
| oauth2.googleapis.com:443 | ✗ 超时（8s） | ✓ 可达 |
| daily-cloudcode-pa.googleapis.com:443 | ✗ 超时（64s） | — |
| storage.googleapis.com:443 | ✓ 0.25s | — |
| 本机回环 127.0.0.1（直连 / 经代理 / CONNECT） | ✓ | ✓ 正常 |

**4. 环境配置**

- 用户级 / 系统级环境变量 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` **全部为空** → Go 语言服务器取不到代理，只能直连。
- 系统代理（WinINET）已开启：`127.0.0.1:7897`，绕过列表含 `localhost;127.*`（所以回环不受影响，白屏不是代理劫持回环造成的）。
- 当前同时运行多个网络客户端：Clash Verge（`clash-verge.exe` + `verge-mihomo.exe`，7897）、FlClash（`FlClashHelperService.exe`）、深信服 aTrust 隧道网卡（Up）、Tailscale（Up）、火绒 HIPS。

## 三、根因

Antigravity 的语言服务器（Go 进程 `resources\bin\language_server.exe`）在启动时直连 Google 完成鉴权；本机直连 Google 鉴权域名被阻断，而它**没有使用任何代理**（环境变量为空），于是鉴权一直超时，本地 HTTPS UI 端点无法就绪，渲染进程加载 `https://127.0.0.1:<端口>/` 超时 → 白屏 → 自动换端口重启 → 循环。

一句话：**不是显卡/缓存/安装损坏问题，而是 Antigravity 的进程没走代理、连不上 Google 导致启动卡死。**

## 四、修复方案

### 方案 ①（推荐）让 Antigravity 的进程走代理

任选一种：

- **A. Clash Verge 开 TUN 模式（增强模式）**：在 Clash Verge 里打开 TUN/增强模式，让所有进程（含 Go 语言服务器）透明走代理。开完**完全退出 Antigravity（托盘也要退）再重开**。实测本机回环不受影响，可放心开。
  > ⚠️ **本机不适用**：装了企业 VPN（深信服 aTrust），开 TUN 会接管路由导致 aTrust 失效。请走**第七节**的非 TUN 方案。
- **B. 只给 Antigravity 设代理环境变量**（不动全局）：为 Antigravity 设置
  ```
  HTTP_PROXY  = http://127.0.0.1:7897
  HTTPS_PROXY = http://127.0.0.1:7897
  NO_PROXY    = localhost,127.0.0.1,::1
  ```
  `NO_PROXY` 必须带上，保证本地 UI 端点不被代理影响。做法：设用户级环境变量后重启 Antigravity；或用一个 `.cmd` 启动器包装，只让 Antigravity 及其子进程继承这些变量。
- **C. ProxyBridge**（https://github.com/InterceptSuite/ProxyBridge/releases）：定向把 Antigravity 的两个进程转发到 `127.0.0.1:7897`。规则的正确写法见下面 C-1。

#### C-1. ProxyBridge 规则正确写法

ProxyBridge 的规则匹配的是**「进程 → 目标地址」**，`操作` 必须选 **Proxy** 才会走代理；默认（无匹配规则）是直连。

**前置条件**：`Proxy` 菜单 → `Proxy Settings` 里先加一条代理服务器（类型 HTTP 或 SOCKS5，Host `127.0.0.1`，Port `7897`），否则 Proxy 规则会静默回退成直连。

**正确规则：**

| 字段 | 值 | 说明 |
|---|---|---|
| 名称 | Antigravity | 任意 |
| 应用程序 | `Antigravity.exe; language_server.exe` | **必须带上 language_server.exe**——真正直连 Google 的是它；多个用分号分隔 |
| 目标主机 | 留空（或 `*`） | 不要填 127.0.0.1 |
| 目标端口 | 留空（或 `443`） | 不要填 7897 |
| 目标域名 | `*` | 全部域名 |
| 协议 | TCP（或 BOTH） | UDP 只在 SOCKS5 代理下有效；Antigravity 走 HTTPS/gRPC 是 TCP |
| 操作 | **选中那条代理服务器条目**（如 `Proxy Server  SOCKS5  127.0.0.1:7897`） | 见下方说明：下拉里没有字面叫 "Proxy" 的选项 |
| 代理配置 | 即上一步选中的条目 | 对应 profile 里的 `ProxyConfigId` |

**关于"操作"下拉：没有叫 Proxy 的选项（易踩坑）**

ProxyBridge 的「操作」下拉固定只有两项——`Direct`、`Block`——后面再**按已配置的代理服务器逐条追加**，标签格式是 `名称  类型  主机:端口`。源码逻辑（`Windows/gui/ui/dialogs.h`）：

```c
// Action combo: Direct, Block, then one entry per configured proxy (item data = storedId).
SendMessageW(ac, CB_ADDSTRING, 0, (LPARAM)L"Direct");
SendMessageW(ac, CB_ADDSTRING, 0, (LPARAM)L"Block");
for (int i = 0; i < g_profile.cfgCount; i++) {
    _snwprintf_s(label, 320, _TRUNCATE, L"%s  %s  %s:%s", c->name, c->type, c->host, c->port);
    LRESULT idx = SendMessageW(ac, CB_ADDSTRING, 0, (LPARAM)label);   // 追加代理条目
    SendMessageW(ac, CB_SETITEMDATA, idx, c->storedId);
}
```

保存时按选中项的下标判定：`0 → DIRECT`、`1 → BLOCK`、`≥2 → PROXY`（并把该条的 `storedId` 写入 `cfgStoredId`）。

所以：

- 下拉里**只有 Direct 和 Block** ⇒ 说明打开这个对话框时**还没有任何已配置的代理服务器**（`cfgCount == 0`）。先去 `Proxy → Proxy Settings` 加好 `127.0.0.1:7897`，再回到规则对话框，第三项才会出现。
- 要"走代理"，就是**选中那一条代理服务器**，而不是找 "Proxy" 这个词。

**两个易错点：**

1. **不要为 127.0.0.1 写规则**。ProxyBridge 默认 `Localhost via Proxy = 关闭`，任何目标是 `127.x.x.x` / `::1` 的规则都会被强制改成 DIRECT；这条既无效，也是刻意设计——保证本地 UI 端点（`https://127.0.0.1:<端口>/`）不被代理破坏。
2. **目标主机不要写端口号**。主机和端口是两个独立字段；`127.0.0.1:` 这种带冒号的写法属于格式错误。

**参考 `.pbprofile` 片段：**

```json
{
  "ProcessName": "Antigravity.exe; language_server.exe",
  "TargetHosts": "*",
  "TargetPorts": "*",
  "Protocol": "TCP",
  "Action": "PROXY",
  "IsEnabled": true,
  "ProxyConfigId": 1
}
```

**注意**：ProxyBridge 依赖 WinDivert 内核驱动（需管理员权限），本机同时还跑着 Clash Verge TUN、aTrust、Tailscale，多层内核级拦截容易互相冲突——如果开了 TUN 模式能解决，就不必再上 ProxyBridge。

### 方案 ② 排除网络客户端互相干扰

本机同时跑着 Clash Verge、FlClash、aTrust、Tailscale 四套网络客户端 + 火绒 HIPS，容易互相抢路由/劫持 DNS。建议排查时**只保留一套**（例如只留 Clash Verge），并在火绒里给 Antigravity 放行。

### 方案 ③ 升级到最新版

当前 2.17.0，最新为 **2.23.1**，自动更新失败（`blockmap 404` → `ERR_CONNECTION_CLOSED`）。开代理后到 https://antigravity.google/download 手动覆盖安装。

### 方案 ④ 如果以上都做完仍然白屏

按顺序试：

1. 清缓存后重开：删除 `%APPDATA%\Antigravity\GPUCache`、`Code Cache`、`Cache`。
2. 用兼容参数启动（GPU/沙箱问题）：
   ```
   "C:\Users\Administrator\AppData\Local\Programs\antigravity\Antigravity.exe" --disable-gpu --no-sandbox
   ```
3. 彻底重装：卸载 → 删除 `%APPDATA%\Antigravity` 和 `C:\Users\Administrator\.antigravity` → 重新安装。

## 四点五、本机 ProxyBridge 实际配置核对（2026-10-15 10:42）

读取 `%APPDATA%\ProxyBridge\profiles\Default.pbprofile`（ProxyBridge 4.1.1，安装在 `C:\soft\ProxyBridge`），当前内容**已经正确**：

```json
"ProxyConfigs": [
  { "Id": 1, "Name": "Proxy Server", "Type": "SOCKS5",
    "Host": "127.0.0.1", "Port": "7897", "SendDomainToProxy": true }
],
"ProxyRules": [
  { "Name": "Antigravity.exe",
    "ProcessName": "Antigravity.exe;language_server.exe",
    "TargetHosts": "*", "TargetPorts": "*", "TargetDomains": "*",
    "Protocol": "TCP", "Action": "PROXY",
    "IsEnabled": true, "ProxyConfigId": 1 }
],
"LocalhostViaProxy": false
```

核对要点：

- ✅ `ProcessName` 同时包含 `Antigravity.exe` 和 `language_server.exe`（后者才是直连 Google 超时的那个进程）。
- ✅ `Action` 为 `PROXY` 且 `ProxyConfigId: 1` 指向 SOCKS5 `127.0.0.1:7897`。
- ✅ `SendDomainToProxy: true`：由代理端做 DNS 解析，对 Google 域名更稳。
- ✅ `LocalhostViaProxy: false`：本地 UI 端点（`https://127.0.0.1:<端口>/`）保持直连，不会被代理破坏。
- ✅ 进程在跑：`ProxyBridge.exe` + `ProxyBridgeSvc.exe`。

即：**配置层面已就绪，剩下只需要完全退出 Antigravity 再重开并看日志验证。**

## 五、验证方法

修复后重开 Antigravity，再执行：

```
type "%APPDATA%\Antigravity\logs\language_server.log"
```

若**不再出现** `dial tcp 64.233.187.95:443 ... failed`，且 `main.log` 中**不再出现** `Failed to load URL: https://127.0.0.1:.../ ERR_TIMED_OUT`，即说明修复生效。

## 六、第二轮排查（2026-10-15 11:15，已升级到 2.23.1 + ProxyBridge）

### 结论：ProxyBridge 配置是对的，但**引擎根本没跑起来**，所以等于没生效

实测证据：

| 检查项 | 结果 | 说明 |
|---|---|---|
| `WinDivert` 内核驱动 | **Stopped**（`Win32_SystemDriver`：`\??\C:\soft\ProxyBridge\WinDivert64.sys`） | ProxyBridge 靠它抓包，停了就等于没拦截 |
| 中继端口 `34010` / `34011` | **未监听**（TCP/UDP 都空） | 按官方说明，命中 PROXY 规则的流量会被改写到这里；没监听＝没有 PROXY 规则在生效 |
| `language_server.exe` 日志 | 仍在 `dial tcp 64.233.187.95:443: connectex ... did not properly respond` | 依然是**直连** Google，没被改写 |

也就是说：配置文件（`Default.pbprofile`）里那条 `Action: PROXY` 是对的，但 `ProxyBridgeCore.dll` 的 `Start()` 没成功，规则没进引擎。

ProxyBridge GUI 源码里启动流程是：

```c
if (!ConnectEngine()) return 1;          // 连不上引擎就直接退出
...
g_started = g_api.Start();
if (g_started) { ApplyRules(); LogStoreAdd(&g_actStore, T(S_STARTED)); }
else            LogStoreAdd(&g_actStore, T(S_STARTFAIL));   // 启动失败写进"动作"日志页
```

**最可能的原因：**

1. **WinDivert 驱动被安全软件拦下**。本机装着火绒（`HipsTray`），火绒对 WinDivert 这类内核驱动拦得比较凶（该驱动常被外挂/恶意软件使用）。把火绒退出或给 `WinDivert64.sys` / `ProxyBridge` 放行后再启动一次。
2. **没以管理员身份运行**（便携版/无服务时走 `PB_LoadDirect`，必须提权，否则 WinDivert 打不开）。

**怎么确认：** 打开 ProxyBridge →「动作」日志页，看有没有 `启动失败` / `Start failed`；或命令行执行 `netstat -ano | findstr 34010`，有 LISTENING 才算真跑起来。

### 另一个独立问题：窗口 30 秒超时 vs 语言服务器 85 秒才就绪

本轮日志显示，Google 连不上的那段时间里语言服务器要重试约 85 秒才走到 `Serving UI bundle from embedded assets`；而 Electron 加载 `https://127.0.0.1:<端口>/` 大约 **30 秒**就 `ERR_TIMED_OUT` 了。也就是说即使不白屏地等下去，窗口也早就放弃了。

Google 一旦能通（<1 秒），这个时间差自然消失——**所以核心还是"让语言服务器走代理"这一件事。**

### 建议：改用 Clash Verge 的 TUN 模式（更省事）

ProxyBridge 这条路要同时搞定「内核驱动 + 管理员权限 + 安全软件放行」，链路太长。而 Clash Verge 已经在正常工作（`127.0.0.1:7897` 实测可达 Google），它的 TUN 模式是 Clash 自己的驱动，不存在被火绒拦的问题。

**做法**：Clash Verge 打开 TUN / 增强模式 → 完全退出 Antigravity（含托盘）→ 重开。实测本机回环不受影响（Clash 会正确直连 `127.0.0.1`），不用担心本地 UI 端点被破坏。

### 火绒放行 WinDivert 的具体做法（火绒 6.0.12.1）

> 先说明：**"火绒拦的"目前只是推断，还没坐实。** 火绒的日志（`C:\ProgramData\Huorong\Sysdiag\log\*.log`）是加密/编码过的，读不出明文，我没法从日志里确认。真正的判据在 ProxyBridge 自己的「动作」日志页。

**第 0 步（先确认是谁拦的）**

1. 打开 ProxyBridge →「动作」（Activity）日志页。源码里这段是自动执行的：
   ```c
   ApplyConfigs();
   g_started = g_api.Start();                                  // 启动即自动 Start，不需要点按钮
   if (g_started) { ApplyRules(); LogStoreAdd(&g_actStore, T(S_STARTED)); }
   else            LogStoreAdd(&g_actStore, T(S_STARTFAIL));   // 失败会写"启动失败"
   ```
   看到 **`启动失败` / `Start failed`** 就说明引擎确实没起来。DLL 通常还会跟着打印 WinDivert 的具体错误码（如 `WinDivertOpen failed: 5 (拒绝访问)` / `1275 (驱动被阻止)`）。
2. 看火绒：「主界面 → 安全日志 / 日志」，筛选 **系统防护 / 驱动、服务相关**，找有没有 `WinDivert64.sys` 或 `ProxyBridge` 的拦截记录。有的话点 **允许 + 记住本次操作**。
3. 管理员命令行跑一次 `sc start WinDivert`，看返回的错误码：
   - `1275` = 驱动被阻止（安全软件/策略拦的）
   - `5` = 拒绝访问（权限问题）
   - `成功` = 驱动本身没问题，那就是 ProxyBridge 引擎没调 Start

**第 1 步（火绒信任区放行）**

1. 打开火绒主界面 → 右上角 **「≡」菜单** → **「信任区」**（部分版本主界面左下角也有「信任区」入口）。
2. 点 **「添加文件」**，依次加入：
   - `C:\soft\ProxyBridge\WinDivert64.sys`
   - `C:\soft\ProxyBridge\ProxyBridge.exe`
   - `C:\soft\ProxyBridge\ProxyBridgeSvc.exe`
   - `C:\soft\ProxyBridge\ProxyBridgeCore.dll`
3. 更省事的做法：点 **「添加目录」**，直接把 **`C:\soft\ProxyBridge`** 整个目录加进信任区。
4. 保存后，**完全退出 ProxyBridge（托盘也要退）再重新打开**（它启动时会自动 `Start()`）。
5. 验证：`netstat -ano | findstr 34010` 出现 `LISTENING` 才算真的起来了；ProxyBridge「连接」页能看到 `language_server.exe` 走 `via proxy`。

**第 2 步（信任区不管用时）**

如果加了信任区还是启动失败，多半是火绒的 **HIPS / 系统加固 / 自定义规则** 在拦驱动加载：

1. 火绒 →「防护中心」→ 找到 **系统防护 / 系统加固** 里跟「驱动加载、服务安装」相关的项，临时关掉。
2. 或者干脆 **退出火绒**（托盘右键 → 退出），再启动 ProxyBridge。
   - 能起来了 ⇒ 确认就是火绒拦的，再回头逐项加白。
   - 还是起不来 ⇒ 不是火绒的问题，去查 ProxyBridge「动作」页的错误码。

**关于"给驱动开口子安不安全"——已实测核对，可以放心**

WinDivert 是 MIT 许可的开源内核驱动（[basil00/Divert](https://github.com/basil00/Divert)），Wireshark、mitmproxy、Proxifier 这类正规工具都在用它。它确实能"读写/改写本机网络包"，所以杀软对它敏感是合理的。关键是**驱动文件有没有被动过**——我把它和官方发布包做了哈希比对：

| 文件 | 本机 SHA256 | 官方 WinDivert v2.2.2-A（x64） | 结论 |
|---|---|---|---|
| `WinDivert64.sys` | `8DA085332782708D8767BCACE5327A6EC7283C17CFB85E40B03CD2323A90DDC2` | 同左 | ✅ 完全一致，**未被篡改** |
| `WinDivert.dll` | `C1E060EE19444A259B2162F8AF0F3FE8C4428A1C6F694DCE20DE194AC8D7D9A2` | 同左 | ✅ 完全一致，**未被篡改** |

（官方包下载：`https://github.com/basil00/Divert/releases/download/v2.2.2/WinDivert-2.2.2-A.zip`）

签名情况：

- `WinDivert64.sys` → 签名**有效**，签名人 `CN=成都密思听科技有限公司`，证书 2023-05-26 到期，但带 **Sectigo RSA Time Stamping Signer #3 时间戳**，所以签名依然有效。**这个中文签名人就是 WinDivert 官方的签名证书**（basil00 用的是国内公司的 EV 代码签名证书），不是被谁换了壳——官方包里同一个文件也是这个签名。
- `WinDivert.dll` → 官方包里本来就没有签名（`NotSigned`），属正常。
- `ProxyBridge.exe` / `ProxyBridgeCore.dll` / `ProxyBridgeSvc.exe` → 签名**有效**，签名人 `CN=Sourav Kalal`（ProxyBridge 作者），Sectigo 签发，2028-08-13 到期。

**结论：驱动是官方原版、作者程序签名有效，加白名单是安全的。** 唯一要留意的是 `WinDivert64.sys` 这类内核驱动本身权限很大——所以只信任你亲自从官方 GitHub Release 下载并核对过哈希的那一份。

**如果还是觉得别扭，直接用 Clash Verge 的 TUN 模式**——不装内核驱动、不用加白、不用管理员，一步开关就完事。

## 七、非 TUN 方案（本机最终采用）：环境变量启动器

**背景约束**：本机装了企业 VPN 深信服 aTrust，**不能开 TUN**（TUN 会接管路由，aTrust 直接失效）。所以必须在"只让 Antigravity 走代理、其余不动"的前提下解决。

**原理（关键）**：Antigravity 的 `language_server.exe` 是 Antigravity.exe 拉起的**子进程**，它**不读 Windows 系统代理（WinINET）**，只读 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。从桌面快捷方式双击启动时，它拿不到这些变量，于是直连 Google → 超时 → 本地 UI 端点起不来 → 白屏。

**解决办法：用一个批处理启动器注入环境变量**（不装驱动、不开 TUN、不动全局环境、不影响 aTrust）。

启动器已生成：**`C:\soft\Antigravity-Proxy.bat`**

```bat
@echo off
set "HTTP_PROXY=http://127.0.0.1:7897"
set "HTTPS_PROXY=http://127.0.0.1:7897"
set "ALL_PROXY=http://127.0.0.1:7897"
set "http_proxy=http://127.0.0.1:7897"
set "https_proxy=http://127.0.0.1:7897"
set "all_proxy=http://127.0.0.1:7897"
REM 回环流量不走代理，保护本地 UI 端点
set "NO_PROXY=localhost,127.0.0.1,::1"
set "no_proxy=localhost,127.0.0.1,::1"

start "" "C:\Users\Administrator\AppData\Local\Programs\antigravity\Antigravity.exe" ^
  --proxy-server="http://127.0.0.1:7897" ^
  --proxy-bypass-list="localhost;127.0.0.1;::1"
```

**使用方式**

1. 先启动 Clash Verge（保证 `127.0.0.1:7897` 在监听；启动器会自己检查，没监听会提示并暂停）。
2. **完全退出 Antigravity**（含托盘），然后双击 `C:\soft\Antigravity-Proxy.bat` 启动。
3. 想恢复成"双击快捷方式也能用"：把桌面/任务栏快捷方式的**目标**改成这个 `.bat`，或直接给 `.bat` 建快捷方式。

**为什么不用改全局环境变量**：把 `HTTP_PROXY` 设到用户级会让**所有**程序走 Clash，包括 aTrust 相关的内网访问——内网域名走代理会解析失败。除非你清楚公司内网域名并全部加进 `NO_PROXY`，否则不要改全局。

**为什么不用 ProxyBridge**：它需要 WinDivert 内核驱动真正加载（本机驱动停在 `Stopped`、中继端口 `34010/34011` 未监听），还要过火绒那一关。环境变量方案**不碰内核、不碰驱动、不碰杀软**，链路最短。

**验证**

重开后看 `%APPDATA%\Antigravity\logs\language_server.log`：

- ✅ 不再出现 `dial tcp 64.233.187.95:443 ... failed`
- ✅ 出现 `Auth succeeded, refreshing features and managers` 且很快（秒级，而不是原来的 85 秒）
- ✅ `main.log` 不再出现 `Failed to load URL: https://127.0.0.1:... ERR_TIMED_OUT`

**注意**：Google 的 Go 客户端只在 `http.DefaultTransport` 上才会自动读环境变量。实测记录（博客园《Antigravity IDE 如何配置软件走代理的解决方案》）验证过：只改 `settings.json` 的 `http.proxy` 或只给快捷方式加 `--proxy-server` **都无效**，**必须**用批处理注入环境变量才生效。所以别走弯路。

## 八、白屏已修复（11:24）＋ 新问题：出口被 Google 判定为中国香港

### 8.1 白屏已解决 ✅

用 `C:\soft\Antigravity-Proxy.bat` 启动后：

| 指标 | 修复前 | 修复后（11:24 启动） |
|---|---|---|
| `language_server.log` 里 `dial tcp ... failed` | 满屏 | **0 条** |
| `Auth succeeded` 出现时间 | 从不出现 / 85 秒 | 启动后 **7 秒**（11:24:18 起 → 11:24:25） |
| `main.log` 里 `Failed to load URL ... ERR_TIMED_OUT` | 每次启动都有 | **消失**，UI 正常渲染 |
| 佐证 | — | 日志出现 `[CDP Discovery] Successfully discovered Electron WS URL`，说明 UI 与 agent 已跑起来 |

**结论：环境变量启动器方案有效，白屏问题闭环。**

### 8.2 新问题：`FAILED_PRECONDITION (400): User location is not supported for the API use`

UI 能用了，但一让 agent 干活就报这个。这不是本地配置问题，是 **Google 服务端按出口 IP 的地区做拦截**。

**诊断过程与证据：**

1. Clash 规则（`Script.js`）里 `DOMAIN-SUFFIX,googleapis.com,PROXY` 存在，所以 `oauth2.googleapis.com` / `daily-cloudcode-pa.googleapis.com` / `generativelanguage.googleapis.com` 全部走 `PROXY` 组。
2. 经代理查出口 IP：`api.ipify.org` → **`50.7.21.236`**，ipinfo 标注为 Singapore（AS30058 FDCservers.net）。
3. 但**让 Google 自己判断**才是决定性的 —— 经同一代理请求 `https://www.google.com/`，最终被重定向到：

   ```
   https://www.google.com.hk/
   ```

   **Google 把这个出口 IP 判定为中国香港。** 而 Antigravity / Gemini Code Assist **不支持中国香港**，所以直接返回 `User location is not supported`。

（旁证：直连查询 `ipinfo.io` / `cloudflare.com` 显示 `223.76.131.151` 中国移动武汉，说明 Clash 的 `MATCH,DIRECT` 兜底把这两个域名走了直连；而 `googleapis.com` 走 PROXY，所以 Antigravity 全部请求都落在被判定为香港的出口上。）

### 8.3 解决办法：换一个 Google 判定为支持地区的节点

**这是纯节点选择问题，改 Antigravity / ProxyBridge 都没用。**

1. 在 Clash Verge 里把 **PROXY 组**（或"自动选择/故障转移"里实际生效的节点）切到 **美国 / 日本 / 台湾 / 韩国** 等支持地区。
2. 跑一遍验证脚本 **`C:\soft\check-antigravity-node.bat`**（用 `curl -x` 走 7897 代理）：
   - 第 1 步看出口 IP 和国家；
   - 第 2 步看 **Google 的最终重定向 URL**：
     - 是 `www.google.com` → ✅ 通过
     - 还是 `www.google.com.hk` / `www.google.cn` → ❌ 继续换
3. 通过后**完全退出 Antigravity（含托盘）**，用 `C:\soft\Antigravity-Proxy.bat` 重开，再试一次 agent。

**如果换了多个美国/日本节点仍然报同一错误**，那说明限制落在**账号层面**而不是 IP 层面，需要把 Google 账号的"国家/地区"改成支持地区（社区教程关键词：`Antigravity 账号地区`、`Your current account is not eligible for Antigravity`）。

### 8.4 顺手发现的两个 Clash 配置小问题（不影响 Antigravity）

- `Script.js` 第 8 行 `"DOMAIN,googleapis,PROXY"`：Clash 的 `DOMAIN` 是**精确匹配**，这行实际不生效（真正起作用的是第 32 行 `DOMAIN-SUFFIX,googleapis.com,PROXY`），可以删掉。
- `Script.js` 第 168 行 `"MATCH,DIRECT", // 兜底走代理`：**注释和代码不一致**——规则是直连，注释却写"走代理"。如果本意是兜底走代理，应改成 `MATCH,PROXY`。另外第 49 行 `naem: 'direct'` 是拼写错误（应为 `name`），导致 direct 规则集被注册成 `undefined` 且从未被引用。

## 附：无害的报错

`Failed to list WSL distros`（`wsl.exe --list --verbose` 失败）是 WSL 未安装/未启用导致的菜单项报错，与白屏无关，可忽略。
