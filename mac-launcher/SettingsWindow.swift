import AppKit
import WebKit

@MainActor
final class SettingsWindow: NSWindowController, WKScriptMessageHandler, WKNavigationDelegate {
    private let webView: WKWebView
    private let folder: URL
    private let handle: (String, [String: Any]) async throws -> Any
    private var section = "general"

    init(studio: URL, handle: @escaping (String, [String: Any]) async throws -> Any) {
        self.folder = studio.appendingPathComponent("editor", isDirectory: true)
        self.handle = handle
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Moonlit Desk — Settings"
        window.minSize = NSSize(width: 780, height: 560)
        window.contentView = webView
        window.center()
        window.isReleasedWhenClosed = false
        super.init(window: window)
        configuration.userContentController.add(self, name: "settings")
        webView.navigationDelegate = self
        webView.loadFileURL(folder.appendingPathComponent("preferences.html"), allowingReadAccessTo: folder)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func open(section: String = "general") {
        self.section = section
        window?.title = "Moonlit Desk — " + L10n.text("设置")
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        selectSection()
    }

    private func selectSection() {
        let data = try? JSONSerialization.data(withJSONObject: [section])
        if let data, let json = String(data: data, encoding: .utf8) {
            webView.evaluateJavaScript("window.showSettingsSection?.(\(json)[0])", completionHandler: nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { selectSection() }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.isFileURL,
              url.standardizedFileURL.path.hasPrefix(folder.standardizedFileURL.path + "/") else {
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              url.isFileURL, url.standardizedFileURL.path == folder.appendingPathComponent("preferences.html").standardizedFileURL.path,
              let body = message.body as? [String: Any], let id = body["id"] as? String,
              let action = body["action"] as? String else { return }
        let input = body["input"] as? [String: Any] ?? [:]
        Task {
            let result: [String: Any]
            do { result = ["id": id, "data": try await handle(action, input)] }
            catch { result = ["id": id, "error": L10n.text(error.localizedDescription)] }
            guard JSONSerialization.isValidJSONObject(result),
                  let data = try? JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed]),
                  let json = String(data: data, encoding: .utf8) else { return }
            _ = try? await webView.evaluateJavaScript("window.settingsResponse(\(json))")
        }
    }
}
