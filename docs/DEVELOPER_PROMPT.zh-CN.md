# Moonlit Desk 交接开发提示词

下面代码块内为可直接复制给下一位 AI／开发者的完整上下文。末尾替换“本次任务”即可；需求范围应以用户随后补充为准。

```text
你现在接手 Moonlit Desk。请先理解当前代码和状态，再完成我指定的本次任务，不要只给方案。

一、项目身份
- 产品：Moonlit Desk，独立的 macOS Hexo 写作、备份、发布工具。
- 仓库文件夹名 Moonlit_Desk，公开仓库 https://github.com/jiahecairen/Moonlit_Desk。
- 常见本机位置 ~/DevSoftware/Moonlit_Desk；实际路径以环境和 pwd 为准，不要硬编码。
- 工具仓库与使用者的 Hexo 博客是不同项目。个人网站、主题、文章不属于工具公开源码。
- 先读可用的 AGENTS.md 等工作区规则，再读 docs/HANDOFF.zh-CN.md、docs/PROJECT_GUIDE.zh-CN.md、README.md、package.json。
- 交接文档状态日期为 2026-11-25；后续事实以源码、测试与 Git 当前状态为准。

二、用户已经明确的产品要求
1. 默认富文本，像直接写文章；MD 按钮能切换进入和退出 Markdown 编辑。
2. 常用格式工具始终可见，更多功能通过“高级”展开。
3. 新文章英文标题、中文标题、文件名三者填一个即可；英文生成短横线 slug，只有中文时拼音加下划线。
4. 支持插入、粘贴和拖入图片。
5. 文章里可选择／添加标签、分类与关键词，网站设置可管理这些名称及网站名。
6. 不自动添加 Chinese version。折叠内容按需添加、标题自定义，编辑时展开，网站上默认收起点击可见。
7. 保存文章要保留版本，发布前也备份，包含本地引用资源；相同内容和资源不得重复备份。
8. 保持备份失败时不覆盖文章，保持外部修改冲突检查。
9. 菜单栏默认仅显示月亮；可选应用名、网站名或自定义图标。
10. 月亮必须是网站同款 🌑🌒🌓🌔🌕🌖🌗🌘 Unicode 彩色表情，不要自绘月面替代，不要转为单色模板。
11. 用户不要定位授权弹窗：当前默认系统时区估算，离线且无权限请求；可主动选择 IP 城市定位或手动经纬度。不得未经要求恢复 CoreLocation/GPS 自动授权。
12. 月相由当前时间决定，地理位置用于观察朝向，白天也显示；时区估算必须明确是代表城市而非真实当前位置。
13. 工具要可公开、可换博客，保留未来扩展接口；不要重新与个人网站耦合。

三、技术架构
- Swift AppKit 原生菜单栏：mac-launcher/main.swift、Services.swift、EditorFeature.swift、ProjectCreator.swift。
- main.swift 中 LauncherFeature 是编译期扩展协议，不是动态插件平台。
- Finder／启动台的应用图标固定 🌗，从 Resources/AppIconMoon-HD.png 高清透明母图用 make-icon.swift 缩制多尺寸 PNG，build.sh 用 iconutil 打包；CFBundleIconFile 必须设置。它与菜单栏图标独立。
- 月相：LunarPhase.swift（SunCalc 近似公式）、MoonIcon.swift（Apple Color Emoji，isTemplate=false）、MoonLocation.swift（时区与 IP 数据解析）、StatusAppearance.swift（偏好与刷新）。
- 新版已移除 CoreLocation 和定位权限 plist 键；保留旧偏好仅用于迁移。
- Node HTTP 服务：editor/server.js，只监听 127.0.0.1，默认 4510。
- 博客预览默认 4000，编辑器与原生端口逻辑尚未统一为动态配置。
- 前端传统 defer 全局脚本：app.js、settings-ui.js、rich-editor.js、editor-moon.js；不要随意打乱加载顺序。
- 富文本为 contenteditable + 浏览器命令，marked 渲染，DOMPurify 清理，Turndown/GFM 序列化；特殊 HTML 卡片保留。
- metadata.js 管文章属性与全站词条，configuration.js 用 YAML AST 保留配置注释。
- article-backups.js 管文章哈希版本；Services.swift 管整站 ZIP 去重。
- publisher.js 在临时快照中 generate，推送生成文件到目标分支，不是博客源码 Git 同步。
- project-setup.js 在临时目录创建新 Hexo 8.1.2，安装并检查首页后重命名为最终目录。

四、配置与数据
- 本机设置 ~/Library/Application Support/Moonlit Desk/settings.json：projectPath、backupFolder，兼容旧 articleBackupPath/bilingual。
- UserDefaults 域 org.moonlitdesk.app：显示、月相来源、手动坐标、IP 缓存、backupHours、lastBackup。
- moonLocationMode：timezone 默认、ip、manual。旧自动定位 true 迁移到 timezone，旧手动坐标迁移成 manual。
- IP 请求仅在 ip 模式访问 https://ipapi.co/json/，缓存 6 小时，失败一小时后重试，回退系统时区；不上传文章／配置／GPS，不存原始 IP。
- 时区先读 /usr/share/zoneinfo/zone.tab，再读打包的公有领域 IANA 表；无法匹配使用标准朝向，不能从 UTC offset 猜纬度。
- Node 优先 MOONLIT_PROJECT，其次 --project，再是 settings.json。MOONLIT_SETTINGS 仅影响 Node。
- MOONLIT_ARTICLE_BACKUPS 用于指定直接版本根目录，EDITOR_PORT 可改 Node 端口。
- MOONLIT_DEPLOY_TEST_REPO 仅隔离本地 Git 测试使用。
- 凭据由 gh 管理。不要读取或输出 token，不要提交用户配置、坐标、文章、备份或私有文档。

五、工作要求
1. 开始检查 git status，保留他人改动。历史上 .gitignore 有用户私有文档忽略规则，不得覆盖或顺手提交无关内容。
2. 使用临时测试博客、临时备份根和本地 bare Git 仓库；不要拿真实个人文章做破坏性测试。
3. 先确认问题，再改动相关层；避免无关重构和一键升级所有依赖。
4. 完成用户已授权任务，不反复请求常规实施许可；遇真实阻碍说明具体原因。
5. 不把文档待办列表当成授权自动实施的路线图。
6. 源文件修改后需重建 .app 才会进入 bundle Resources；检查当前运行的是源码服务还是打包版，避免验证旧 UI。
7. 不盲目 kill 旧 PID、不强推、不清空用户 defaults、不删除备份。重启前确认无用户未保存内容或正在执行任务。
8. 若需要第三方 API，使用官方文档，说明默认是否联网；定位无弹窗偏好必须保持。
9. 不发送邮件／消息，不上传私有文件；对工具仓库源码与网站发布的授权分别判断。
10. 中文简洁汇报进度；最终说明完成行为、测试和实际限制，附可用路径或仓库链接。

六、验证
- Node 功能：npm test。
- 月相／位置／原生：npm run test:mac，npm run build:mac。
- 格式：git diff --check，必要的 node --check。
- UI 改动实际验证输入、状态切换、MD 往返、保存与重开。只存在按钮不等于功能完成。
- 月亮检查网站同款 emoji、不是黑色模板圆、明暗背景可见。
- 定位检查 timezone 默认无权限调用无联网，未知时区回退，IP 错误响应及切换取消不覆盖新状态。
- 别把本地 Git 测试称为真实 GitHub Pages 上线，别把本地 OneDrive 目录写入称为云同步完成。
- 如授权提交，用明确文件列表 stage，检查 diff，正常提交推送并验证远端；不要将 .app 和依赖提交。

七、已知限制，修改相关模块前必须知道
- 没有自动保存／崩溃恢复、完整版本恢复 UI、资源清理或备份保留策略。
- 富文本复杂嵌套、任意 HTML 与跨文档撤销可能存在保真边界。
- 发布复制源快照不具备跨文件事务；外部并发修改可能混合；草稿转正式发生在远端成功之前。
- 发布根目录文件的白名单不覆盖所有自定义主题／插件配置。
- /images/editor 绝对 URL 对项目 Pages 子路径需要专项验证。
- OneDrive 由本地同步客户端完成，不是工具云端 API。
- 应用只在运行时定时备份；默认一天，0 为仅手动；不接管外部服务。
- 当前无签名公证发行、Universal Binary、自动更新、多站点并行、正式动态插件系统或 CI。
- 细节见项目说明，不要隐藏这些限制，也不要未经要求全部重写。

本次任务：
【在这里填写具体目标、复现步骤、预期行为、约束和验收标准。】

如果这一栏还没填写，先完成只读接手检查，报告可用状态与需要的任务信息，不自动实施已知问题清单。
```

使用建议：只需要修改单个功能时，保留相关约束与本次任务即可；跨模块开发则保留完整提示词。提示词不包含用户私有配置，不应手动补入凭据或真实备份内容。
