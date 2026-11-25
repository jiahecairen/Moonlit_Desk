import AppKit
import ServiceManagement

protocol LauncherFeature {
    @MainActor var isBusy: Bool { get }
    @MainActor func menuItems() -> [NSMenuItem]
    @MainActor func shutdown()
}

extension LauncherFeature {
    @MainActor var isBusy: Bool { false }
    @MainActor func shutdown() {}
}

@MainActor
final class Launcher: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var project: URL?
    private let studio: URL
    private let defaults = UserDefaults.standard
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let contextMenu = NSMenu()
    private var buildingMenu: NSMenu?
    private var settingsWindow: SettingsWindow?
    private let log: URL
    private var server: Process?
    private var timer: Timer?
    private var appearance: StatusAppearance?
    private var isBackingUp = false
    private var nextRetry = Date.distantPast
    private var features: [any LauncherFeature] = []
    private var serverNotice: String?
    private var backupError: String?
    private var dateFormat: Date.FormatStyle { Date.FormatStyle(date: .abbreviated, time: .shortened).locale(Locale(identifier: L10n.language == "zh" ? "zh_CN" : "en_IE")) }
    private let defaultInterval = 24

    init(studio: URL) {
        self.studio = studio
        if let selected = StudioSettings.load()["projectPath"] as? String {
            self.project = URL(fileURLWithPath: selected, isDirectory: true)
        }
        log = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Moonlit-Hexo.log")
        super.init()
        configureFeatures()
    }

    private var interval: Int {
        (defaults.object(forKey: "backupHours") as? Int) ?? defaultInterval
    }

    private var destination: URL? {
        if let path = StudioSettings.load()["backupFolder"] as? String {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return Self.oneDriveFolder() ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Moonlit Desk/Backups", isDirectory: true)
    }

    private static func oneDriveFolder() -> URL? {
        let cloud = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/CloudStorage", isDirectory: true)
        let folders = (try? FileManager.default.contentsOfDirectory(
            at: cloud, includingPropertiesForKeys: [.isDirectoryKey], options: .skipsHiddenFiles)) ?? []
        let matches = folders.filter {
            $0.lastPathComponent.hasPrefix("OneDrive-") &&
            (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        }
        guard matches.count == 1 else { return nil }
        return matches[0].appendingPathComponent("Moonlit Desk Backups", isDirectory: true)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        appearance = StatusAppearance(item: statusItem, studio: studio, project: { [weak self] in self?.project })
        appearance?.start()
        menu.delegate = self; contextMenu.delegate = self
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.appearance?.refresh(); self?.runScheduledBackup() }
        }
        if project == nil {
            DispatchQueue.main.async { self.showSettings(section: "blog") }
        } else { runScheduledBackup() }
        if CommandLine.arguments.contains("--settings") { showSettings() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        appearance?.stop()
        features.forEach { $0.shutdown() }
        if server?.isRunning == true { server?.terminate() }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if isBackingUp || features.contains(where: { $0.isBusy }) {
            showError("后台任务正在进行，请稍后再退出。")
            return .terminateCancel
        }
        return .terminateNow
    }

    @objc private func statusClicked() {
        guard let button = statusItem.button else { return }
        let event = NSApp.currentEvent
        let right = event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true
        let selected = right ? contextMenu : menu
        selected.popUp(positioning: nil, at: NSPoint(x: 0, y: -4), in: button)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        buildingMenu = menu
        defer { buildingMenu = nil }
        appearance?.refresh()
        menu.removeAllItems()
        if menu === contextMenu {
            add("设置…", #selector(openSettings), key: ",")
            add("关于 Moonlit Desk", #selector(openAbout))
            menu.addItem(.separator())
            add("退出 Moonlit Desk", #selector(quit), key: "q")
            return
        }
        info(project?.lastPathComponent ?? L10n.text("尚未选择博客"))
        if let editor = editorFeature {
            editor.menuItems().forEach { menu.addItem($0) }
            add("新建文章", #selector(newArticle))
        } else { info("请先在设置中连接博客") }
        menu.addItem(.separator())
        let occupied = HexoServer.portOccupied()
        let live = server?.isRunning == true
        info(serverNotice ?? (live ? (occupied ? "Hexo 正在运行" : "Hexo 正在启动") :
            (occupied ? "4000 端口已有服务" : "Hexo 已停止")))
        add("启动 Hexo", #selector(startServer), enabled: project != nil && !live && !occupied)
        add("停止 Hexo", #selector(stopServer), enabled: live)
        add("打开本地博客", #selector(openBlog), enabled: occupied)
        add("查看 Hexo 日志", #selector(openLog), enabled: FileManager.default.fileExists(atPath: log.path))
        menu.addItem(.separator())
        if isBackingUp { info("正在备份…") }
        else if let error = backupError { info("备份失败", tooltip: L10n.text(error)) }
        if let last = defaults.object(forKey: "lastBackup") as? Date { info("上次备份 · " + last.formatted(dateFormat)) }
        add("立即备份", #selector(backupNow), enabled: project != nil && !isBackingUp && destination != nil)
        add("打开备份目录", #selector(openDestination), enabled: destination.map { FileManager.default.fileExists(atPath: $0.path) } ?? false)
        menu.addItem(.separator())
        add("在 Finder 中打开博客目录", #selector(openProject), enabled: project != nil)
    }

    private var editorFeature: EditorFeature? { features.compactMap { $0 as? EditorFeature }.first }
    private var setupFeature: ProjectCreator? { features.compactMap { $0 as? ProjectCreator }.first }
    private var busy: Bool { isBackingUp || features.contains(where: { $0.isBusy }) }

    @objc private func newArticle() { editorFeature?.open(newArticle: true) }
    @objc private func openSettings() { showSettings() }
    @objc private func openAbout() { showSettings(section: "about") }

    func application(_ application: NSApplication, open urls: [URL]) {
        if urls.contains(where: { $0.scheme == "moonlitdesk" && $0.host == "settings" }) { showSettings() }
    }

    private func showSettings(section: String = "general") {
        if settingsWindow == nil {
            settingsWindow = SettingsWindow(studio: studio) { [weak self] action, input in
                guard let self else { return [:] }
                return try await self.handleSettings(action, input)
            }
        }
        settingsWindow?.open(section: section)
    }

    private func settingsState() -> [String: Any] {
        var state = appearance?.preferences() ?? [:]
        state["language"] = L10n.language
        state["projectPath"] = project?.path ?? ""
        state["backupFolder"] = destination?.path ?? ""
        state["backupHours"] = interval
        state["busy"] = busy
        state["setupRunning"] = setupFeature?.isBusy == true
        state["version"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.2.0"
        state["build"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        if #available(macOS 13.0, *) {
            state["launchAtLogin"] = SMAppService.mainApp.status == .enabled || SMAppService.mainApp.status == .requiresApproval
            state["loginNeedsApproval"] = SMAppService.mainApp.status == .requiresApproval
        }
        return state
    }

    private func handleSettings(_ action: String, _ input: [String: Any]) async throws -> Any {
        switch action {
        case "state": return settingsState()
        case "save-language":
            guard let language = input["language"] as? String, L10n.supportedCodes.contains(language) else { throw settingError("设置无效。") }
            var config = StudioSettings.load(); config["language"] = language; try StudioSettings.save(config)
            settingsWindow?.window?.title = "Moonlit Desk — " + L10n.text("设置")
            appearance?.refresh()
        case "save-general":
            if #available(macOS 13.0, *), let enabled = input["launchAtLogin"] as? Bool {
                let current = SMAppService.mainApp.status == .enabled || SMAppService.mainApp.status == .requiresApproval
                if enabled != current {
                    if enabled { try SMAppService.mainApp.register() }
                    else { try await SMAppService.mainApp.unregister() }
                }
            }
        case "save-backups":
            guard let hours = input["backupHours"] as? Int, [0, 24, 168].contains(hours) else { throw settingError("设置无效。") }
            defaults.set(hours, forKey: "backupHours"); runScheduledBackup()
        case "save-appearance": try appearance?.apply(input)
        case "choose-project": guard !busy else { throw settingError("后台任务正在进行，请稍后再试。") }; chooseProject()
        case "create-project": guard !busy else { throw settingError("后台任务正在进行，请稍后再试。") }; setupFeature?.create()
        case "choose-backup": guard !busy else { throw settingError("后台任务正在进行，请稍后再试。") }; chooseDestination()
        case "open-backup": openDestination()
        case "open-project": openProject()
        case "login-settings": if #available(macOS 13.0, *) { SMAppService.openSystemSettingsLoginItems() }
        case "open-editor": editorFeature?.openEditor()
        case "open-repository": NSWorkspace.shared.open(URL(string: "https://github.com/jiahecairen/Moonlit_Desk")!)
        case "api":
            guard let path = input["path"] as? String,
                  ["api/settings", "api/site", "api/taxonomy", "api/deployment", "api/repository"].contains(path),
                  let editor = editorFeature else { throw settingError("请先在设置中连接博客") }
            guard input["projectPath"] as? String == project?.path else { throw settingError("编辑器项目不匹配。") }
            let payload = input["payload"] as? [String: Any]
            if !["api/settings", "api/taxonomy"].contains(path) && payload == nil { throw settingError("设置无效。") }
            return try await editor.request(path: path, payload: payload)
        default: throw settingError("设置无效。")
        }
        return settingsState()
    }

    private func settingError(_ message: String) -> NSError {
        NSError(domain: "Settings", code: 1, userInfo: [NSLocalizedDescriptionKey: L10n.text(message)])
    }

    private func configureFeatures() {
        features = [ProjectCreator(studio: studio) { [weak self] folder in
            self?.connectProject(folder)
        }]
        if let project { features.append(EditorFeature(project: project, studio: studio)) }
    }

    func register(_ feature: any LauncherFeature) {
        features.append(feature)
    }

    @discardableResult
    private func add(_ title: String, _ action: Selector, enabled: Bool = true, key: String = "") -> NSMenuItem {
        (buildingMenu ?? menu).autoenablesItems = false
        let item = NSMenuItem(title: L10n.text(title), action: action, keyEquivalent: key)
        item.target = self
        item.isEnabled = enabled
        (buildingMenu ?? menu).addItem(item)
        return item
    }

    private func info(_ title: String, tooltip: String? = nil) {
        let item = NSMenuItem(title: L10n.text(title), action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.toolTip = tooltip
        (buildingMenu ?? menu).addItem(item)
    }

    @objc private func chooseProject() {
        guard !isBackingUp else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = L10n.text("选择 Hexo 博客")
        panel.directoryURL = project
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        let files = FileManager.default
        guard files.fileExists(atPath: folder.appendingPathComponent("_config.yml").path),
              files.fileExists(atPath: folder.appendingPathComponent("package.json").path) else {
            showError("请选择包含 _config.yml 和 package.json 的 Hexo 博客目录。")
            return
        }
        connectProject(folder)
    }

    private func connectProject(_ folder: URL) {
        var config = StudioSettings.load()
        config["projectPath"] = folder.path
        config.removeValue(forKey: "articleBackupPath")
        do { try StudioSettings.save(config) }
        catch { showError(error.localizedDescription); return }
        features.forEach { $0.shutdown() }
        if server?.isRunning == true { server?.terminate() }
        server = nil
        project = folder
        appearance?.refresh()
        configureFeatures()
        defaults.removeObject(forKey: "lastBackup")
        nextRetry = .distantPast
        serverNotice = nil
        backupError = nil
    }

    @objc private func startServer() {
        guard let project else { return }
        guard server?.isRunning != true, !HexoServer.portOccupied() else { return }
        do {
            serverNotice = nil
            let task = try HexoServer.start(project: project, log: log)
            server = task
            task.terminationHandler = { [weak self] finished in
                let failed = finished.terminationReason == .exit && finished.terminationStatus != 0
                let pid = finished.processIdentifier
                Task { @MainActor in
                    guard let self, self.server?.processIdentifier == pid else { return }
                    self.server = nil
                    self.serverNotice = failed ? "Hexo 启动失败 · 查看日志" : nil
                }
            }
        } catch {
            showError(error.localizedDescription)
        }
    }

    @objc private func stopServer() {
        if server?.isRunning == true { server?.terminate() }
    }

    @objc private func openBlog() { NSWorkspace.shared.open(HexoServer.address) }
    @objc private func openLog() { NSWorkspace.shared.open(log) }
    @objc private func openProject() { if let project { NSWorkspace.shared.open(project) } }
    @objc private func openDestination() {
        if let destination { NSWorkspace.shared.open(destination) }
    }
    @objc private func quit() { Task { await settingsWindow?.flushPendingSettings(); NSApp.terminate(nil) } }

    @objc private func chooseDestination() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = L10n.text("选为备份位置")
        panel.directoryURL = destination?.deletingLastPathComponent()
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        var config = StudioSettings.load()
        config["backupFolder"] = folder.path
        config.removeValue(forKey: "articleBackupPath")
        do { try StudioSettings.save(config) }
        catch { showError(error.localizedDescription); return }
        defaults.removeObject(forKey: "lastBackup")
        nextRetry = .distantPast
        backupError = nil
        runScheduledBackup()
    }

    @objc private func backupNow() { startBackup(interactive: true) }

    private func runScheduledBackup() {
        guard interval > 0, Date() >= nextRetry else { return }
        let last = defaults.object(forKey: "lastBackup") as? Date ?? .distantPast
        guard Date().timeIntervalSince(last) >= Double(interval) * 3600 else { return }
        startBackup(interactive: false)
    }

    private func startBackup(interactive: Bool) {
        guard !isBackingUp, let project, let destination else { return }
        isBackingUp = true
        backupError = nil
        let service = BackupService(project: project)
        Task {
            let result = await Task.detached(priority: .utility) {
                Result { try service.create(in: destination) }
            }.value
            isBackingUp = false
            switch result {
            case .success:
                defaults.set(Date(), forKey: "lastBackup")
                nextRetry = .distantPast
            case .failure(let error):
                backupError = error.localizedDescription
                nextRetry = Date().addingTimeInterval(900)
                if interactive { showError(error.localizedDescription) }
            }
        }
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Moonlit Desk"
        alert.informativeText = L10n.text(message)
        alert.alertStyle = .warning
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}

if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--backup" {
    let project = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    let destination = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
    do {
        print(try BackupService(project: project).create(in: destination).path)
    } catch {
        FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
        exit(1)
    }
} else {
    MainActor.assumeIsolated {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        guard let resources = Bundle.main.resourceURL else { fatalError("Missing application resources") }
        let launcher = Launcher(studio: resources)
        app.delegate = launcher
        withExtendedLifetime(launcher) { app.run() }
    }
}
