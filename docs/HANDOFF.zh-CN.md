# Moonlit Desk 开发交接文档

交接日期：2026-11-25；当前版本 1.2.0，build 5。

本文用于让另一位开发者或 AI 在没有聊天记录的情况下继续维护。完整原理、API 和路径字典见 [项目说明](PROJECT_GUIDE.zh-CN.md)；可复制的任务提示词见 [开发提示词](DEVELOPER_PROMPT.zh-CN.md)。

## 最新交付：双语与统一设置

默认英文，支持中文；语言在 Application Support/settings.json 的 language 键中保存。**左键**菜单为写作／服务／备份操作，**右键**为 Settings、About、Quit。不要重新把配置子菜单混入左键菜单。

统一设置窗口是 SettingsWindow.swift + 本地 WKWebView，页面在 editor/preferences.*。八个分区：General、Blog & Folders、Backups、Moon & Appearance、Website、Tags & Categories、GitHub Publishing、About。原生偏好、博客目录、创建博客、备份目标／频率、登录项、网站与部署设置全部归入此窗口。

浏览器 Settings 按钮走 moonlitdesk://settings，要求应用已注册 URL scheme。旧 settings-dialog HTML 与站点设置 JS 已移除，settings-ui.js 只留文章属性和入口。文章属性不属于全局配置，仍在编辑页面。

重点：本地设置页面不能被远程 HTML 替代；桥只接受指定本地文件的主 frame，API 路径有白名单；EditorFeature.request 确认项目与 token/Origin 后才请求博客接口。不能把一个通用 shell／任意 URL 执行器暴露到 WKWebView。

已实际检查英文默认设置、中文切换、切回英文保存、Website 现有字段加载和 About；语言只改 UI，不改用户正文。曾发现只切语言也注销登录项的错误，现已修成仅在状态变化时调用系统服务。系统登录项实际开启／关闭仍受 macOS 许可影响，不用来回切换测试用户真实自启动偏好。

语言文件为 ui-strings.json（Swift 读取）与 ui-strings.js（浏览器读取），内容必须一致；i18n.js 负责 UI，勿对整个用户文章 DOM 运行通用翻译器。Node 增加只读 /api/preferences，编辑器轮询并在重新聚焦时更新。

### 自动生效更新（build 5）

所有设置去掉 Save，文字防抖约 700ms，开关／下拉 change 后生效。语言变成注册表驱动的下拉，立即渲染并以 save-language 独立持久化，不调用登录项 API。文章停止输入约 1s 自动保存及去重备份，切换文章先冲刷，保留 YAML、revision、备份失败阻止覆盖的保护。

新增 autosave.js / autosave.test.js、languages.json、generate-i18n.js、ui-language.js。新增语言只加注册条目和字典，再运行 npm run i18n:generate；build 自动生成 JS 词典包。已在隔离博客验证未按保存按钮输入、自动备份、刷新并重新打开正文。

设置旧项目的待写入项须在切换时取消，桥 api 请求携带 projectPath 并由原生核对，防止防抖中的旧表单写到新博客。错误应显示真实状态，不能用“已自动保存”掩盖未完成或失败的输入。

### 写作模型工作台（可选功能）

编辑器新增 `/writer` 页面（左键菜单“打开写作模型”、侧栏“写作模型”链接、编辑页“投递到写作模型”按钮）。它连接一个外部的写作模型工作区：包含可执行 `laysay`、`models.yaml` 和 `lsw/bridge.py` 的目录，路径保存在 Application Support/Moonlit Desk/writer.json，不写入代码。

- editor/writer.js：只调用白名单 bridge 命令（`laysay bridge <命令>`，JSON 走标准输入）和白名单后台任务（reverse、build、train、generate、check、quantize、write），参数逐项校验；同一时间只运行一个任务，编辑器退出时终止。
- 投递只读取文章，并从文章版本备份中取第一个有效版本作为初稿，不修改博客。
- 加载模型的任务先查询 GPU 剩余内存，其他本地模型占用时拒绝开始；工作区一侧也会再检查一次。
- 页面为 writer.html / writer-ui.js / writer.css，界面字符串已加入 ui-strings.json。测试见 writer.test.js。

## 1. 接手时最重要的事实

1. 这是独立的 Hexo 工具，不是某个网站主题。不得把使用者博客路径、域名、文章或账号硬编码回工具。
2. 文件夹名 Moonlit_Desk；产品展示名 Moonlit Desk；公开仓库为 https://github.com/jiahecairen/Moonlit_Desk。
3. 原生 AppKit 菜单栏程序负责进程、整站备份、设置和月相；Node 服务负责浏览器编辑器、文章版本、生成站点发布。
4. 默认编辑模式是富文本，按钮切换到 MD，再切回来；不要恢复成只预览不能编辑。
5. 常用工具一直显示，高级功能通过“高级”展开；文章属性位于独立折叠面板。
6. 新文章不默认添加 Chinese version；折叠区域标题由用户自定义，站点默认关闭、编辑时展开。
7. 发布按钮构建并推送整个网站的生成文件，不等于源码 Git 同步，不等于只发布当前文章。
8. 任何覆盖性文章保存都先备份；备份失败必须保留原文。相同内容与图片组合不得重复备份。
9. 菜单栏要使用网站同款 Unicode 月相表情，不能重新换成自绘纹理球，也不能使用 monochrome template。
10. 用户明确不要定位授权弹窗。最新代码不使用 CoreLocation；默认系统时区估算、可选 IP 或手动输入。
11. 文档中的已知问题是风险记录，不是授权下一位开发者自动改造整个项目。

## 2. 建议接手步骤

```sh
pwd
git status --short
git log -8 --oneline
node --version
npm --version
swiftc --version
```

确认自己在工具仓库而不是博客仓库。常见本机位置为 `~/DevSoftware/Moonlit_Desk`，但代码不得依赖这个约定。读取当前环境的 AGENTS.md 等本地指导后再修改。

不要为了开工清空工作区。交接时 `.gitignore` 存在用户单独添加的私有文档忽略规则，这不是月相功能的变更；应保留并独立处理。未来工作区状态以实际 git status 为准。

阅读顺序：

1. README 与本交接文档。
2. package.json、mac-launcher/build.sh。
3. main.swift、Services.swift、EditorFeature.swift。
4. server.js、project.js、article-backups.js、publisher.js。
5. app.js、settings-ui.js、rich-editor.js。
6. MoonLocation.swift、LunarPhase.swift、MoonIcon.swift、StatusAppearance.swift。
7. 两类测试与完整项目说明的限制清单。

依赖缺失时执行 npm ci。依赖已就绪且本次未改动时，不需要无理由重复安装。执行：

```sh
npm test
npm run test:mac
npm run build:mac
git diff --check
```

## 3. 最新已交付内容

### 3.1 基础工具

- 从原博客拆离；外部 JSON 连接当前项目。
- 已初始化 Git，main 分支对应公开 GitHub 仓库。
- 不上传 node_modules、.app、.local、环境文件、日志。
- 创建新 Hexo 时用隐藏临时目录安装验证，再重命名；未覆盖已有目标。
- 支持 gh 创建仓库、部署分支和 Pages 配置。

### 3.2 内容与编辑

- 英／中标题和文件名三者可任填其一。
- 英文标题默认短横线 slug，中文拼音以下划线分隔。
- 富文本默认、MD 双向切换和按钮状态正常。
- 文件／粘贴／拖放图片；图片跟随文章版本保存。
- 文章标题、第二语言标题、日期、标签、分类、关键词 UI。
- 网站名称／描述／关键词，以及全站标签／分类／关键词新增重命名删除。
- 自定义折叠标题，无强制 Chinese version。
- 常用和高级两级工具栏；表格空单元格曾产生拆行，已在 tableCellLines 规则中处理。

### 3.3 菜单栏与月相

- 默认不显示产品名，支持 none / app / site。
- 支持实时月相和自定义图标。
- 原先模板图标出现黑圆，已禁用 template。
- 中间的自绘月面被用户否定，最终必须保持原生彩色月亮表情。
- 当前相位连续计算，图标离散八相；表情按观察角旋转。
- Finder／启动台的应用图标固定 🌗，先增强到 Resources/AppIconMoon-HD.png 透明母图，再由 make-icon.swift 缩制 + iconutil 生成 ICNS；不要混淆应用图标与菜单栏实时图标。
- 默认时区估算不联网、不弹定位授权框。
- IP 只由用户选择后启用；缓存 6 小时，失败回退时区，重试间隔至少 1 小时。
- 手动位置独立保存；旧系统自动定位偏好迁移为时区默认。

## 4. 本次验证记录及不能声称的事项

截至本次交付，执行了：

- Node 测试五组，覆盖多条断言；全部通过。
- Swift 月相参考数据测试，通过。
- Swift 位置解析、未知时区、南北半球、IP 响应校验测试，通过。
- 原生应用重新编译、临时签名与资源打包，成功。
- 源码 diff 空白检查，通过。

此前还实际测试过创建 Hexo 8.1.2、安装并生成首页；富文本工具栏、下划线、表格、折叠内容和 MD 往返通过浏览器检查。月亮八相曾离线渲染在明暗背景下检查。临时预览文件可能存在 .local，但它们不是发布所需文件，也不是自动化测试的一部分。

本次没有真实查询出口 IP，没有创建额外远程站点仓库，没有实际发布用户的网站来做测试。GitHub 推送测试使用本地 bare Git 远端；工具仓库自身的上传另行验证。OneDrive 只验证本地备份逻辑，不能声称云端同步完成。

后续提交可能改变上述结论，接手人应运行相关测试并记录本次结果，而不是复制“全部通过”。

## 5. 关键运行数据：在哪，不能做什么

| 数据 | 位置 | 维护注意 |
| --- | --- | --- |
| 当前博客／备份目标 | ~/Library/Application Support/Moonlit Desk/settings.json | 保留用户值，不提交 |
| 显示／位置／备份频率 | UserDefaults org.moonlitdesk.app | 不整域 reset；不要读出真实坐标上传 |
| gh 凭据 | gh 管理 | 用 gh auth status，不打印 token |
| 文章 Markdown 与图片 | 所选博客 source_dir | 真实用户数据，测试用临时项目 |
| 文章版本 | 外部备份根，按站点与文章隔离 | 不批量删除，不覆盖损坏版本 |
| 配置旧版 | 博客 .moonlit/config-versions | 当前没有专用恢复 UI |
| 整站 ZIP | 备份目标根 | 不包含依赖和 Git 历史 |
| 构建包 | 本仓库 Moonlit Desk.app | 忽略于 Git，每次重建资源来自源码 |

本项目公开文档只写路径结构与样例，不复制 settings.json、真实坐标、OneDrive 文件内容、私有商业文档或凭据。

## 6. 生命周期和状态约束

### 原生

- main.swift 的 Launcher 持有 project、server、features、appearance 和一分钟 timer。
- 所有菜单更新在主 actor，备份工作在后台 detached task。
- 程序退出时关闭自己启动的编辑器／服务器；备份或创建忙碌时拒绝正常退出。
- 不接管未知 4000 / 4510 进程；端口被占用不等于归自己所有。
- 切换项目先保存设置，再关闭旧功能并重建。
- 改源码后，要重建应用；已经运行的二进制不会自动更新。

### 编辑器

- root 与 source 在 Node 进程启动时确定。
- 前端 editor.value 是同步后的 Markdown；savedText 是已保存参考。
- revision 对应服务端磁盘原文，禁止跳过冲突检查。
- richMode、richReady、uploading、saving、publishing、metadataPending 共同控制操作。
- metadataQueue 串行处理属性变化，save 等待队列。
- activeLoad / renderSequence 避免较慢响应覆盖较新文档。
- API 发布状态保存在内存中；Node 重启不恢复任务状态。

### 位置

- StatusAppearance 不再创建 CLLocationManager。
- timezone 来源使用 zone.tab；不能从单独 UTC offset 推断纬度。
- IP 请求使用临时 URLSession；只有显式 ip 模式启动。
- ipGeneration 防止旧请求清理掉新请求句柄或覆盖新设置。
- 改定位模式时取消请求；默认启动不发送 IP 查询。
- 系统已有定位授权状态可以留着，但新版没有 API 调用，所以不会触发新的授权弹窗。

## 7. 必须保住的数据安全行为

1. 文章路径必须位于 source 下，只允许 _posts/_drafts Markdown，不操作越界或符号链接路径。
2. 图片备份的 realpath 需在 source 中，不能跟随外部路径泄漏文件。
3. 保存先备份，再临时写并 rename；备份出错不能继续写。
4. 配置写入前比对旧文本；文章保存比对 revision。
5. 整站备份目标禁止在博客内部，避免无限递归。
6. 发布清理只面向上次生成清单，保留未知文件，不 force push。
7. gh 使用已有凭据，不在应用设置或网页上新增 token 明文字段。
8. 工具仓库默认公开。提交前只 stage 本任务文件，检查 diff；不要 git add . 把用户其他工作顺手上传。

## 8. 扩展点与待办建议

优先级是接手建议，不是当前待执行任务；只有用户明确选择后才实施。

### 优先解决的正确性问题

- 项目 Pages 子路径与 `/images/editor` 绝对路径兼容。
- 发布快照对自定义根配置文件及主题配置的收集完整性。
- 草稿转正式后发布失败的用户反馈与回退机制。
- 多进程写入／发布锁与快照一致性。
- 富文本复杂内容 round-trip 样本与每文档 undo/redo 行为。
- 恢复旧版文章及资源的 UI，备份损坏检测与保留策略。

### 产品化

- 成熟富文本编辑器是否替换 contenteditable，需要迁移试验而非直接重写。
- 可配置端口与多站点集合。
- 自动保存的本地 crash recovery 与失败草稿恢复。
- 更多语言、版本号统一、签名公证、DMG、自动更新。
- CI：Node 在隔离 runner，Swift 在 macOS runner，避免测试访问个人数据。
- 升级旧依赖，先兼容测试而非一键全量 npm update。

完整未完成清单见项目说明第 14 节。不要在 README 中提前承诺这些功能。

## 9. 实际开发和发布流程

1. 明确用户本次要求与受影响的代码层。
2. 确认 Git 工作区、当前运行应用和是否有未保存文章／正在备份。
3. 在工具仓库实施；用户博客测试用临时 fixture 或明确授权的样本。
4. Node 变更跑 npm test，月相／原生变更跑 test:mac 与 build:mac。
5. 富文本修改需要浏览器操作验证“输入 → 切换 MD → 切回 → 保存 → 重开”；仅看到按钮不算完成。
6. 定位改动应检查默认无权限 API、离线回退、模式切换和不发不必要网络请求。
7. 原生图标改动要检查非模板、emoji 来源及明暗菜单栏背景。
8. diff --check，按明确文件 stage；不要提交 .app、依赖、配置或私有文件。
9. 如果用户要求同步源码，正常 commit/push main 并验证远端提交，不替网站点击发布。
10. 更新本说明或相应文档，记录测试范围和仍存在的限制。
11. 应用可安全重启时重建并重启；发现用户正在编辑或执行任务时保留状态并说明如何加载新版。

## 10. 常用命令与恢复动作

```sh
# 仓库内开发
npm ci
npm test
npm run test:mac
npm run build:mac

# 仅运行编辑器，避免改用户持久设置
MOONLIT_PROJECT=/absolute/path/to/test-blog EDITOR_PORT=4513 npm start

# 只读查看端口
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:4510 -sTCP:LISTEN

# 不输出凭据
 gh auth status

# 独立 CLI 整站备份，用临时／指定目标
'Moonlit Desk.app/Contents/MacOS/MoonlitDesk' --backup /path/to/blog /path/outside/blog/backups
```

不要复制粘贴一个已过期 PID 执行 kill。先确认当前进程命令、所属博客和操作状态。不要删除整个 defaults 域来修复单个设置。不要为排查图片路径执行清空 source。

## 11. 接手验收标准

- 能说明工具与博客的边界，能从源码定位一个完整保存／发布流程。
- 在不读取或修改用户私有文章的前提下运行测试。
- 能指出 default timezone 与 IP 模式的区别、真实精度及无授权弹窗保证来源。
- 能解释月亮必须使用 Apple Color Emoji 且禁止 template 的原因。
- 能区分本地成功备份与 OneDrive 上传完成、Git push 与 Pages 上线。
- 能重建应用并确认运行资源来自新版本。
- 能说明本次改动、测试及未覆盖场景，不引用聊天记忆代替源码证据。
