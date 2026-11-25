import AppKit

@MainActor
final class ProjectCreator: NSObject, LauncherFeature {
    private let studio: URL
    private let onCreated: (URL) -> Void
    private var process: Process?
    var isBusy: Bool { process?.isRunning == true }

    init(studio: URL, onCreated: @escaping (URL) -> Void) {
        self.studio = studio
        self.onCreated = onCreated
    }

    func menuItems() -> [NSMenuItem] {
        let item = NSMenuItem(title: isBusy ? "正在创建 Hexo 博客…" : "新建 Hexo 博客…", action: #selector(create), keyEquivalent: "")
        item.target = self
        item.isEnabled = !isBusy
        return [item]
    }

    @objc private func create() {
        let folder = NSOpenPanel()
        folder.canChooseDirectories = true
        folder.canChooseFiles = false
        folder.canCreateDirectories = true
        folder.prompt = "选择博客的父目录"
        NSApp.activate(ignoringOtherApps: true)
        guard folder.runModal() == .OK, let parent = folder.url else { return }

        let alert = NSAlert()
        alert.messageText = "新建 Hexo 博客"
        alert.informativeText = "创建后会自动安装依赖并验证首页，需要网络连接。"
        let name = NSTextField(string: "")
        name.placeholderString = "文件夹名称，例如 my-blog"
        let title = NSTextField(string: "")
        title.placeholderString = "网站名称，例如 My Blog"
        let stack = NSStackView(views: [name, title])
        stack.orientation = .vertical
        stack.spacing = 10
        stack.frame = NSRect(x: 0, y: 0, width: 360, height: 62)
        alert.accessoryView = stack
        alert.addButton(withTitle: "创建博客")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let value = name.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value != ".", value != "..", !value.contains("/"), !value.contains(":") else {
            show("请填写有效的博客文件夹名称。")
            return
        }
        let target = parent.appendingPathComponent(value, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: target.path) else {
            show("目标目录已经存在，请换一个文件夹名称。")
            return
        }
        let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Moonlit-Setup.log")
        do {
            let task = try HexoServer.start(project: parent, log: log,
                script: studio.appendingPathComponent("editor/project-setup.js").path,
                arguments: [target.path, title.stringValue])
            process = task
            task.terminationHandler = { [weak self] result in
                let success = result.terminationStatus == 0
                Task { @MainActor in
                    guard let self else { return }
                    self.process = nil
                    if success {
                        self.onCreated(target)
                        self.show("博客已创建并选中。打开文章编辑器，点击「网站设置」即可设置 GitHub 仓库。")
                    } else {
                        let text = (try? String(contentsOf: log, encoding: .utf8)) ?? "请检查网络后重试。"
                        self.show("创建失败。\n" + String(text.suffix(1800)))
                    }
                }
            }
        } catch { show(error.localizedDescription) }
    }

    private func show(_ text: String) {
        let alert = NSAlert()
        alert.messageText = "Moonlit Desk"
        alert.informativeText = text
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
