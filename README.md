# alexsonicLAb（独立站）

输入一个网址，服务器在无头 Chromium 里打开那个页面，用作品集里同一套 Lab 代码读出它的「形状」（盒子、每行文字、分区边界、图片亮度），再交给同一个 ASCII DJ 台播放成 techno。

- 读页面的是服务器：浏览器不能跨域读别人网站的 DOM 或像素。
- 返回给前端的只有派生几何：盒子类型和坐标、每行一小段文字（最多 160 字）、分区边界、媒体亮度。**页面的 HTML 不会离开服务器。**
- 播放端就是作品集里的 `SonicLab`（双 deck 控制台）：deck A 循环播放从扫描里截下的 1/2/4/8 小节（L 加载），deck B 是正在扫描的页面，交叉推子混两边（← →）。另外有风格、五个 player 的静音、roll、carve、SORT/MELT、录音和海报；回放链接形如 `/?url=…#perf=…`，`/?url=…&style=acid` 这类链接也照样能用。
- 可调参数的后续规划见 [`docs/参数规划.md`](docs/参数规划.md)。

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

`app/lib/scanPage.ts`、`sonicSignals.ts`、`sonicPlayers.ts`、`sonicSynth.ts`、`sonicPerformance.ts`、`app/data/sonicStyles.ts`、`app/components/SonicLab.tsx`、`SonicDeck.tsx`、`sonicLab.css`、`app/utils/environment.ts`。

改 Lab 时先在作品集里改，再同步：

```bash
npm run sync-lab -- ../alex-portfolio-starter
```

为此作品集那边做了三处改动（作品集里的 Lab 行为不变，已经逐个盒子、逐行比对过）：

1. `snapshotPage(root, options)` 改成自包含函数，靠参数决定读什么。`PORTFOLIO_PAGE` 是作品集原来的读法；`GENERIC_PAGE` 读任意网站：landmark 当分区、带边框或阴影的块当卡片、文字截断、最多读 30000px 高。服务器把这个函数的源码注入到无头页面里执行。
2. `SonicLab` 新增 `snapshot`、`linkQuery`、`autoEnter`、`enterLabels` 四个可选属性（`enterLabels` 是大按钮的文字和下方的提示）。不传时就是作品集原来的行为。
3. Lab 的样式移到 `app/components/sonicLab.css`，由组件自己引入。

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
- `scripts/check-security.mjs`：32 项全过。包括上面那些私有地址，`postman-echo.com` 重定向到 `127.0.0.1` / `169.254.169.254` / `localtest.me`，401、403、`github.com/login`、PNG 图片、卡住的端口（超时）、不存在的域名、规范化 308，以及限流（第 9 次返回 429）。

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

## Vercel：限制和费用

**还没有部署，也没有建 Vercel 项目。** 要上线请先告诉我。以下是按文档和本地构建估算的：

已核实的：

- 函数打包后不能超过 **250 MB（未压缩）**。本项目 `/api/scan` 追踪出的文件约 **75 MB**（`@sparticuz/chromium` 67 MB，`playwright-core` 7 MB），够用。
- `maxDuration` 在 `vercel.json` 和路由里都设成 60 秒。开了 Fluid compute 时，内存要在 Dashboard 里设，不能写在 `vercel.json` 里；Chromium 建议 2 GB 以上。
- Vercel 会覆盖 `x-forwarded-for` / `x-real-ip`，客户端伪造不了，所以按 `x-real-ip` 限流是可靠的。
- 内存里的缓存和限流只在单个实例内有效：实例之间不共享，冷启动后清空。跨实例的缓存靠 CDN（`s-maxage`）。要让限流精确，可以用 Vercel WAF 的 `@vercel/firewall` `checkRateLimit`，或者 Upstash Redis。

未核实的（价格以 vercel.com/pricing 为准，下面是我记得的数，可能过时）：

- Fluid compute 按「活跃 CPU 时间 + 预置内存 GB·小时 + 调用次数」计费：大约 $0.128/CPU 小时、$0.0106/GB 小时、$0.60/百万次调用（iad1）。
- 一次没命中缓存的扫描约 2–9 秒墙钟，按 2 GB、平均 5 秒、约 3 秒活跃 CPU 算，**每次约 $0.0001–0.0002，也就是每 1000 次 $0.1–0.2**，冷启动另算（解压 Chromium 要几秒，本地没法测）。
- Hobby 每月包含的额度大约能跑几千次扫描。但 Hobby 只限非商业用途，正式公开用建议上 Pro。
- 返回的 JSON 每次 0.1–0.7 MB，会计入流量。

上线前还要在 Vercel 上真跑一遍：本地用的是装在电脑上的 Chrome，`@sparticuz/chromium` 只在打包层面验证过（文件都被追踪进去了），还没在 Vercel 的 Linux 上实际启动过。

## 已知的不足

- 必须登录的页面、有强反爬的网站读不了（这是设计如此，会给出提示）。
- 无限滚动的页面只读到 30000px。
- Cookie 弹窗会被一起读进去（比如 BBC 的分区里会有 `cookies-on-the-b`）。
- 媒体亮度只算页面前 16000px，再往下的图片按默认值 0.5。
