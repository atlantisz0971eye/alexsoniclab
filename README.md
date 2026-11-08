# alexsonicLAb（独立站）

输入一个网址，服务器在无头 Chromium 里打开那个页面，用作品集里同一套 Lab 代码读出它的「形状」（盒子、每行文字、分区边界、图片亮度），再交给同一个 ASCII DJ 台播放成 techno。

- 读页面的是服务器：浏览器不能跨域读别人网站的 DOM 或像素。
- 返回给前端的只有派生几何：盒子类型和坐标、每行一小段文字（最多 160 字）、分区边界、媒体亮度。**页面的 HTML 不会离开服务器。**
- 播放端就是作品集里的 `SonicLab`（双 deck 控制台）：deck A 循环播放从扫描里截下的 1/2/4/8 小节（L 加载），deck B 是正在扫描的页面，交叉推子混两边（← →）。另外有风格、五个 player 的静音、roll、carve、SORT/MELT、录音和海报；回放链接形如 `/?url=…#perf=…`，`/?url=…&style=acid` 这类链接也照样能用。
- 所有参数都可以调，并且都写进地址栏，一个链接就能复现「哪个网站、怎么读、怎么响、谁在放」。详见下面「参数」和「AI DJ」两节，规划和进度见 [`docs/参数规划.md`](docs/参数规划.md)。

## 参数

网址页的 `[SETUP +]` 放 A 层；进了 Lab 以后，右上角 `[PARAMS ⚙]` 抽屉里四层都有。所有参数定义在一张表里（`app/lib/params.ts`），地址栏、服务器白名单、缓存 key 和两个面板都从这张表生成。

| 层 | URL 键 | 作用 |
| --- | --- | --- |
| A 读取（服务器，改了要重扫，抽屉里会变成橙色并出现 RESCAN） | `w` `dark` `clean` `wait` `h` `lang` | 视口 390/1280/1920，深色模式，隐藏 Cookie 弹窗，等待 fast/normal/patient，深度 10K/30K/60K，语言 |
| B 映射 | `row` `dir` `kinds` `cols` | 行高 10/20/40，从下往上读，只读文字/方框/图片/链接，列数 |
| C 声音 | `bpm` `swing` `root` `drums` `breakdown` `typist` `arch` `typ` `head` `photo` `link` `delay` `reverb` `filter` `sens` | 覆盖风格自带的节奏、调、鼓型，以及五个 player 的音量、效果、滤波范围和灵敏度。不设就按风格来 |
| D 演奏 | `auto` `axis` `curve` `ink` | 自动滚动，读头位置，交叉推子曲线，配色（分区色 / 绿 / 琥珀） |

例子：

```
/?url=https://en.wikipedia.org/wiki/Techno&w=390&clean=1&row=10&bpm=140&drums=broken&ink=amber&seed=c58x4p&ai=1
```

A 层只给预设值，服务器只接受表里有的值，其他一律 400（`bad_param`）。读取参数是缓存 key 的一部分，所以每个网站最多会有几十种扫描结果；默认值不写进链接。

`clean` 只隐藏常见同意工具的弹窗（OneTrust、Cookiebot、BBC 的 ConsentBanner 等）。如果隐藏后页面高度掉了 40% 以上，说明误伤了包住整页的元素，就会自动撤销。

## AI DJ

`[▶ AI DJ]` 是**基于种子的随机演奏**，不调用任何模型，也不联网，完全在浏览器里算。（`app/lib/aiDj.ts`）

- 它看页面的形状：在哪些地方分区，每一段文字和图片有多密。然后用种子（mulberry32 伪随机）写出一整套演奏：
  - 读头在每一段走多快、在哪里停一下、在哪里往回晃；
  - 在分区线上换风格、静音某个 player；
  - 抓 1/2/4/8 小节进 deck A，用交叉推子推进来，过一会儿再推出去、弹出；
  - 段尾的 roll，偶尔的 SORT/MELT 和 carve。
- **同一个种子在同一个页面上永远是同一套**（测试里验证过），所以种子可以分享：`&seed=c58x4p&ai=1`。`[SEED … ↻]` 换一个新种子，就是一套新的。
- 生成的就是 Lab 回放链接用的那种格式（Performance），Lab 照回放的方式放。访客自己一滚动，就把控制权拿回来了。
- 打开带 `ai=1` 的链接时，浏览器要求先点一下才能出声，所以会显示「REPLAY · CLICK TO PLAY」。

## 本地运行

需要 Node 22.18+ 和本机装好的 Google Chrome（或在 `.env.local` 里设 `CHROME_PATH`）。

```bash
npm install
```

```bash
npm run dev
```

打开 http://localhost:3217 （特意不用 8765）。

测试：

```bash
npm test
```

```bash
npm run check:security
```

`npm test` 跑地址判定的单元测试，并在真 Chromium 里验证页面碰不到本机（见下文）。`check:security` 要先开着 dev server，它会把一串恶意地址打到 `/api/scan`，逐条核对结果。

## Lab 代码从哪来

Lab 在作品集仓库里开发，这里是逐字节的副本，清单见 `scripts/sync-lab.mjs`：

`app/lib/scanPage.ts`、`sonicSignals.ts`、`sonicPlayers.ts`、`sonicSynth.ts`、`sonicPerformance.ts`、`labSettings.ts`、`app/data/sonicStyles.ts`、`app/components/SonicLab.tsx`、`SonicDeck.tsx`、`sonicLab.css`、`app/utils/environment.ts`。

改 Lab 时先在作品集里改，再同步：

```bash
npm run sync-lab -- ../alex-portfolio-starter
```

为此作品集那边做了三处改动（作品集里的 Lab 行为不变，已经逐个盒子、逐行比对过）：

1. `snapshotPage(root, options)` 改成自包含函数，靠参数决定读什么。`PORTFOLIO_PAGE` 是作品集原来的读法；`GENERIC_PAGE` 读任意网站：landmark 当分区、带边框或阴影的块当卡片、文字截断、最多读 30000px 高。服务器把这个函数的源码注入到无头页面里执行。
2. `SonicLab` 新增 `snapshot`、`linkQuery`、`autoEnter`、`enterLabels` 四个可选属性（`enterLabels` 是大按钮的文字和下方的提示）。不传时就是作品集原来的行为。
3. Lab 的样式移到 `app/components/sonicLab.css`，由组件自己引入。
4. `SonicLab` 还接受 `settings`（`labSettings.ts`，B/C/D 层全部参数）、`play`（交给它放的一套演奏，比如 AI DJ）、`panel`（宿主自己的面板）。`readRow` 多了可选的行高/方向/种类，synth 多了交叉推子曲线和滤波范围。默认值和以前完全一样，作品集的 snapshot 和每一行都逐一比对过。

## 一次扫描怎么走

`GET /api/scan?url=…` → `app/api/scan/route.ts`

1. 规范化网址；写法不同就 308 跳到唯一写法，让 CDN 缓存命中同一个 key。
2. 查内存缓存（1 小时）。
3. 按 IP 限流（每 IP 每 10 分钟 8 次；每个实例每小时最多 120 次，用来封顶费用）。
4. `server/scan.ts`：先做 DNS 级检查，再开一个新的浏览器 context（1280×800），等页面加载完，滚动一遍触发懒加载，判断是否是机器人拦截页或登录页，执行 `snapshotPage`，最后用一张 1/16 比例的整页截图算每张图片的真实亮度。
5. 成功的结果带 `Cache-Control: s-maxage=3600`，Vercel CDN 会缓存一小时。

## 安全（SSRF 等）

核心是 `server/guardProxy.ts`：**每次扫描单独起一个本地代理，浏览器的所有流量都必须走它。** 页面本身、每一次重定向、脚本、图片、iframe、fetch、WebSocket，每条连接都要经过：

- 只允许 http/https，端口只放 80/443/8080/8443，网址里不能带账号密码；
- 解析 DNS，只要有一个结果是私有、回环、链路本地（含云元数据 169.254.169.254、`fd00:ec2::254`）、CGNAT、保留或组播地址，就拒绝；IPv6 里夹带 IPv4 的各种形式（`::ffff:…`、NAT64、6to4）按里面那个 IPv4 判；
- **只连接到检查通过的那个 IP**（DNS 结果被钉住），所以 DNS rebinding 钻不了空子；
- `localhost`、`*.internal`、`*.local`、不带点的主机名直接拒绝；`2130706433`、`0x7f.0.0.1` 这类写法会先被规范成 `127.0.0.1` 再拒绝。

HTTPS 在代理里是不透明隧道，网站看到的是真 Chrome（TLS 指纹正常），所以被误判成机器人的情况比服务器自己去抓要少。

额外几层防护：启动参数把浏览器的默认代理指向一个不存在的地址，并取消回环地址的免代理；关掉 DNS 预取、后台联网、WebRTC 非代理 UDP；屏蔽 service worker、下载、弹窗、媒体、beacon、WebSocket。

预算：整次扫描 40 秒、导航 20 秒、最多 300 条连接、25 MB 流量、12000 个盒子、页面高度 30000px。

已验证（都可以复现）：

- `test/urlGuard.test.ts`：约 75 个地址和网址写法的判定。
- `test/browserGuard.test.ts`：在真 Chromium 里放一个页面，用 img、iframe、css、fetch、POST、WebSocket、beacon 和整页跳转，去访问 `127.0.0.1`、`localhost`、`[::1]`、`localtest.me`、`127.0.0.1.nip.io`（随机端口和 8080）。本机监听器收到 **0** 个请求，代理拒绝了 62 条连接。另外做过反向对照：把回环地址设成免代理，监听器立刻能收到请求，说明这个测试确实能抓到泄漏。
- `scripts/check-security.mjs`：36 项全过（新增 4 项非法读取参数）。包括上面那些私有地址，`postman-echo.com` 重定向到 `127.0.0.1` / `169.254.169.254` / `localtest.me`，401、403、`github.com/login`、PNG 图片、卡住的端口（超时）、不存在的域名、规范化 308，以及限流（第 9 次返回 429）。

被拦或需要登录的页面会给出清楚的提示：

| 情况 | code | 提示 |
| --- | --- | --- |
| Cloudflare / DataDome / PerimeterX 拦截、验证码、403/429 | `blocked` | This site keeps automated visitors out… |
| 401、跳到登录页、页面基本只是登录表单 | `login` | This page needs a login… |
| 私有地址 | `private_address` | That address points into a private network… |

实测：zillow、reddit、nytimes、linkedin → `blocked`；facebook 设置页、instagram 首页 → `login`。

## 实测扫描（本地，生产构建）

| 网站 | 用时 | 连接数 | 流量 | 盒子数 | 页面高度 |
| --- | --- | --- | --- | --- | --- |
| en.wikipedia.org/wiki/Techno | 8.8 s | 7 | 0.9 MB | 5307 | 30000 px（到上限） |
| www.bbc.com/news | 5.5 s | 61 | 4.8 MB | 846 | 6911 px |
| brittanychiang.com（作品集） | 3.1 s | 10 | 1.6 MB | 215 | 3860 px |
| text.npr.org | 1.5 s | 2 | 22 KB | 73 | 1425 px |
| news.ycombinator.com | 2.3 s | 2 | 30 KB | 625 | 1217 px |

在浏览器里打开过 Wikipedia、BBC 和作品集这三个：都显示成 ASCII，点开声音后示波器、电平表和步进灯都在动；按 4 切 ambient、按 P 切 SORT 也正常。返回给前端的 JSON：Wikipedia 约 680 KB，BBC 约 100 KB（Vercel 会再 gzip）。

## Vercel：部署、限制和费用

**线上地址：https://alexsoniclab.vercel.app**（Vercel 团队 AlexZhao's projects，项目 `alexsoniclab`）。代码在公开仓库 https://github.com/atlantisz0971eye/alexsoniclab ，**推送到 `main` 会自动部署到生产环境**。

在 Vercel 上实测（2026-11-08，iad1，Hobby，Fluid compute，默认内存）：

| 网站 | 扫描用时 | 说明 |
| --- | --- | --- |
| text.npr.org | 5.4 s | 冷启动 |
| brittanychiang.com | 11.4 s | 冷启动：启动 Chromium 4.3 s |
| www.bbc.com/news | 13.6 s | 其中算图片亮度 5 s |
| en.wikipedia.org/wiki/Techno | 21.2 s | 其中算图片亮度 10 s（之后已减半） |

同样的页面在本地 Mac 上只要 2–9 秒，Vercel 上慢 2–3 倍（CPU 少，没有 GPU）。

遇到的限制和对应的改动：

- **函数最长 60 秒：**第一次扫 Wikipedia 超时了（`Task timed out after 60 seconds`），函数一直没有回应。现在每次扫描都有自己的截止时间（fast 32 s / normal 42 s / patient 57 s）：到点就返回 `timeout`，并且把卡住的浏览器扔掉，下一次重新启动。
- **没有 GPU，长截图很贵：**算图片亮度要拍整页截图，在 Vercel 上只截前 3000px；并且只在用掉的时间不到预算 30% 时才做。来不及就用默认亮度。
- **每次扫描的各阶段耗时都写进日志**（`scan phases …`；卡住时是 `scan stuck …`），在 Vercel 的 Logs 里能看到慢在哪一步。
- **打包大小**约 75 MB，在 250 MB 限制以内；每次构建 25–35 秒。
- **限流只在单个实例内有效：**同一个 IP 打到不同实例时会分别计数（实测在不同实例上超过了 8 次）。要精确限流，需要 Vercel WAF 的 `checkRateLimit` 或 Upstash Redis。CDN 缓存（`s-maxage=3600`）是跨实例的。
- **部署时用的是这台 Mac 上已登录的 Vercel CLI（`npx vercel`）：**Vercel 连接器没有创建项目和读部署记录的权限（403）。

在线上做过的安全检查：`127.0.0.1`、`169.254.169.254`、`localtest.me`，以及 postman-echo 重定向到元数据地址，都返回 `private_address`。

费用：价格以 vercel.com/pricing 为准，下面是我记得的数，可能过时。一次没命中缓存的扫描大约是 5–20 秒墙钟、几秒 CPU，按约 $0.128/CPU 小时、$0.0106/GB 小时估算，**每 1000 次约 $0.2–0.5**。Hobby 每月的免费额度大约够几千次扫描。Hobby 只限非商业用途。

## 已知的不足

- 必须登录的页面、有强反爬的网站读不了（这是设计如此，会给出提示）。
- 无限滚动的页面只读到 30000px。
- Cookie 弹窗会被一起读进去（比如 BBC 的分区里会有 `cookies-on-the-b`）。
- 媒体亮度只算页面前 16000px，再往下的图片按默认值 0.5。
