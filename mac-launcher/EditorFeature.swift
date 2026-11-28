import AppKit

@MainActor
final class EditorFeature: NSObject, LauncherFeature {
    private let project: URL
    private let studio: URL
    private var process: Process?
    private var opening = false
    private var requests = 0
    var isBusy: Bool { opening || requests > 0 }
    private let address = URL(string: "http://127.0.0.1:4510/")!

    init(project: URL, studio: URL) {
        self.project = project
        self.studio = studio
    }

    func menuItems() -> [NSMenuItem] {
        let item = NSMenuItem(title: L10n.text(opening ? "正在打开编辑器…" : "打开文章编辑器"), action: #selector(openEditor), keyEquivalent: "")
        item.target = self
        item.isEnabled = !opening
        let writer = NSMenuItem(title: L10n.text("打开写作模型"), action: #selector(openWriter), keyEquivalent: "")
        writer.target = self
        writer.isEnabled = !opening
        return [item, writer]
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

    func ensureReady() async throws {
        if await isReady() { return }
        if process?.isRunning != true {
            let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Moonlit Desk-Editor.log")
            process = try HexoServer.start(project: project, log: log, script: studio.appendingPathComponent("editor/server.js").path)
        }
        for _ in 0..<40 {
            if await isReady() { return }
            if process?.isRunning != true { break }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        throw NSError(domain: "Editor", code: 1, userInfo: [NSLocalizedDescriptionKey: "编辑器未能启动。请检查日志和 4510 端口。"])
    }

    func request(path: String, payload: [String: Any]?) async throws -> Any {
        requests += 1
        defer { requests -= 1 }
        try await ensureReady()
        let (sessionData, _) = try await URLSession.shared.data(from: address.appendingPathComponent("api/session"))
        let session = try JSONSerialization.jsonObject(with: sessionData) as? [String: Any]
        guard session?["projectPath"] as? String == project.path, let token = session?["token"] as? String else {
            throw NSError(domain: "Editor", code: 1, userInfo: [NSLocalizedDescriptionKey: "编辑器项目不匹配。"])
        }
        var request = URLRequest(url: address.appendingPathComponent(path))
        request.timeoutInterval = 180
        if let payload {
            request.httpMethod = "POST"
            request.setValue("http://127.0.0.1:4510", forHTTPHeaderField: "Origin")
            request.setValue(token, forHTTPHeaderField: "X-Editor-Token")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let result = try JSONSerialization.jsonObject(with: data)
        guard let status = (response as? HTTPURLResponse)?.statusCode, status >= 200, status < 300 else {
            throw NSError(domain: "Editor", code: 1, userInfo: [NSLocalizedDescriptionKey: (result as? [String: Any])?["error"] as? String ?? "操作失败。"])
        }
        return result
    }

    @objc func openEditor() { open(newArticle: false) }
    @objc func openWriter() { open(url: address.appendingPathComponent("writer")) }
    func open(newArticle: Bool) {
        open(url: newArticle ? URL(string: "http://127.0.0.1:4510/?new=1")! : address)
    }
    private func open(url: URL) {
        guard !opening else { return }
        opening = true
        Task {
            defer { opening = false }
            do {
                try await ensureReady()
                NSWorkspace.shared.open(url)
            } catch {
                let alert = NSAlert()
                alert.messageText = L10n.text("无法打开文章编辑器")
                alert.informativeText = L10n.text(error.localizedDescription)
                NSApp.activate(ignoringOtherApps: true); alert.runModal()
            }
        }
    }
}
