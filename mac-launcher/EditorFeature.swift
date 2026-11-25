import AppKit

@MainActor
final class EditorFeature: NSObject, LauncherFeature {
    private let project: URL
    private let studio: URL
    private var process: Process?
    private var opening = false
    private let address = URL(string: "http://127.0.0.1:4510/")!

    init(project: URL, studio: URL) {
        self.project = project
        self.studio = studio
    }

    func menuItems() -> [NSMenuItem] {
        let item = NSMenuItem(title: opening ? "正在打开编辑器…" : "打开文章编辑器", action: #selector(openEditor), keyEquivalent: "")
        item.target = self
        item.isEnabled = !opening
        return [item]
    }

    func shutdown() {
        if process?.isRunning == true { process?.terminate() }
    }

    private func isReady() async -> Bool {
        var request = URLRequest(url: address.appendingPathComponent("api/session"))
        request.timeoutInterval = 1
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return json["projectPath"] as? String == project.path && json["token"] is String
        } catch { return false }
    }

    @objc private func openEditor() {
        guard !opening else { return }
        opening = true
        Task {
            defer { opening = false }
            if await isReady() {
                NSWorkspace.shared.open(address)
                return
            }
            do {
                if process?.isRunning != true {
                    let log = FileManager.default.homeDirectoryForCurrentUser
                        .appendingPathComponent("Library/Logs/Moonlit Desk-Editor.log")
                    process = try HexoServer.start(project: project, log: log, script: studio.appendingPathComponent("editor/server.js").path)
                }
                for _ in 0..<30 {
                    if await isReady() {
                        NSWorkspace.shared.open(address)
                        return
                    }
                    if process?.isRunning != true { break }
                    try await Task.sleep(nanoseconds: 200_000_000)
                }
                throw NSError(domain: "Moonlit DeskEditor", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "编辑器未能启动。请检查 ~/Library/Logs/Moonlit Desk-Editor.log 和 4510 端口。"
                ])
            } catch {
                let alert = NSAlert()
                alert.messageText = "无法打开文章编辑器"
                alert.informativeText = error.localizedDescription
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            }
        }
    }
}
