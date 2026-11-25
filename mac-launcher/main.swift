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
    private let log: URL
    private var server: Process?
    private var timer: Timer?
    private var appearance: StatusAppearance?
    private var isBackingUp = false
    private var nextRetry = Date.distantPast
    private var features: [any LauncherFeature] = []
    private var serverNotice: String?
    private var backupError: String?
    private let dateFormat = Date.FormatStyle(date: .abbreviated, time: .shortened)
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
        menu.delegate = self
        statusItem.menu = menu
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.appearance?.refresh(); self?.runScheduledBackup() }
        }
        if project == nil {
            DispatchQueue.main.async { self.chooseProject() }
        } else { runScheduledBackup() }
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

    func menuNeedsUpdate(_ menu: NSMenu) {
        appearance?.refresh()
        menu.removeAllItems()
        info(project?.lastPathComponent ?? "请选择 Hexo 博客目录")
        add("选择博客目录…", #selector(chooseProject), enabled: !isBackingUp && !features.contains(where: { $0.isBusy }))
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
        if isBackingUp {
            info("正在备份…")
        } else if let error = backupError {
            info("备份失败", tooltip: error)
        }
        if let last = defaults.object(forKey: "lastBackup") as? Date {
            info("上次备份 · \(last.formatted(dateFormat))")
        }
        if let folder = destination {
            info("备份位置 · \(folder.lastPathComponent)", tooltip: folder.path)
        } else {
            info("请选择备份位置")
        }
        add("立即备份", #selector(backupNow), enabled: project != nil && !isBackingUp && destination != nil)
        add("选择备份位置…", #selector(chooseDestination), enabled: !isBackingUp)
        add("打开备份目录", #selector(openDestination),
            enabled: destination.map { FileManager.default.fileExists(atPath: $0.path) } ?? false)
        let schedule = NSMenuItem(title: "备份频率", action: nil, keyEquivalent: "")
        let options = NSMenu()
        for (title, hours) in [("每天", 24), ("每周", 168), ("仅手动备份", 0)] {
            let item = NSMenuItem(title: title, action: #selector(changeInterval(_:)), keyEquivalent: "")
            item.target = self
            item.tag = hours
            item.state = hours == interval ? .on : .off
            options.addItem(item)
        }
        schedule.submenu = options
        menu.addItem(schedule)
        for feature in features {
            let items = feature.menuItems()
            if !items.isEmpty {
                menu.addItem(.separator())
                items.forEach { menu.addItem($0) }
            }
        }
        menu.addItem(.separator())
        let display = NSMenuItem(title: "月相与菜单栏显示…", action: #selector(StatusAppearance.showSettings), keyEquivalent: "")
        display.target = appearance
        menu.addItem(display)
        add("在 Finder 中打开博客目录", #selector(openProject), enabled: project != nil)
        if #available(macOS 13.0, *) {
            let login = add("登录时打开", #selector(toggleLogin))
            login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        }
        add("退出 Moonlit Desk", #selector(quit), key: "q")
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
        menu.autoenablesItems = false
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        item.isEnabled = enabled
        menu.addItem(item)
        return item
    }

    private func info(_ title: String, tooltip: String? = nil) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.toolTip = tooltip
        menu.addItem(item)
    }

    @objc private func chooseProject() {
        guard !isBackingUp else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "选择 Hexo 博客"
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
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func toggleLogin() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
                if SMAppService.mainApp.status == .requiresApproval {
                    SMAppService.openSystemSettingsLoginItems()
                }
            }
        } catch { showError(error.localizedDescription) }
    }

    @objc private func chooseDestination() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "选为备份位置"
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

    @objc private func changeInterval(_ item: NSMenuItem) {
        defaults.set(item.tag, forKey: "backupHours")
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
        alert.informativeText = message
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
