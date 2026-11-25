import AppKit
import CoreLocation

@MainActor
final class StatusAppearance: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let item: NSStatusItem
    private let defaults = UserDefaults.standard
    private let manager = CLLocationManager()
    private let studio: URL
    private let project: () -> URL?
    private var siteTitle = ""
    private var titleStamp = ""
    private var readingTitle = false
    private var locationNotice = "等待定位；可在月相设置中手动填写经纬度"
    private var lastLocationRequest = Date.distantPast
    private var hasLocation: Bool { defaults.object(forKey: "moonLatitude") != nil && defaults.object(forKey: "moonLongitude") != nil }
    private var automatic: Bool { defaults.object(forKey: "moonAutoLocation") as? Bool ?? true }

    init(item: NSStatusItem, studio: URL, project: @escaping () -> URL?) {
        self.item = item
        self.studio = studio
        self.project = project
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func start() { refresh(); requestLocation() }
    func stop() { manager.stopUpdatingLocation() }

    func refresh() {
        readSiteTitle()
        let lunar = LunarPhase.calculate(date: Date(),
            latitude: hasLocation ? defaults.double(forKey: "moonLatitude") : nil,
            longitude: hasLocation ? defaults.double(forKey: "moonLongitude") : nil)
        guard let button = item.button else { return }
        let nameMode = defaults.string(forKey: "menuNameMode") ?? "none"
        let name = nameMode == "app" ? "Moonlit Desk" : nameMode == "site" ? (siteTitle.isEmpty ? (project()?.lastPathComponent ?? "请选择博客") : siteTitle) : ""
        let custom = defaults.string(forKey: "menuCustomIcon") ?? "✦"
        let customMode = defaults.string(forKey: "menuIconMode") == "custom"
        button.title = customMode ? custom + (name.isEmpty ? "" : " " + name) : name
        button.image = customMode ? nil : MoonIcon.image(lunar)
        button.imagePosition = name.isEmpty ? .imageOnly : .imageLeading
        // Custom symbols are text, so imageOnly must not hide them.
        if customMode { button.imagePosition = .noImage }
        let location = hasLocation ? String(format: "%.2f°, %.2f°", defaults.double(forKey: "moonLatitude"), defaults.double(forKey: "moonLongitude")) : "未定位 · 标准月相朝向"
        let mode = automatic ? locationNotice : "手动位置"
        button.toolTip = "\(lunar.name) · 照明 \(Int((lunar.fraction * 100).rounded()))%\n\(location) · \(mode)\n按当前时间计算，白天及地平线下也显示"
        button.setAccessibilityLabel("\(lunar.name)，照明 \(Int((lunar.fraction * 100).rounded()))%，\(name.isEmpty ? "博客工具" : name)")
        if automatic && Date().timeIntervalSince(lastLocationRequest) > 3600 { requestLocation() }
    }

    private func requestLocation() {
        guard automatic else { return }
        lastLocationRequest = Date()
        switch manager.authorizationStatus {
        case .denied, .restricted:
            locationNotice = "定位未授权，可在设置中手动填写位置"
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        default:
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        requestLocation()
        refresh()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard automatic, let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        defaults.set((location.coordinate.latitude * 1000).rounded() / 1000, forKey: "moonLatitude")
        defaults.set((location.coordinate.longitude * 1000).rounded() / 1000, forKey: "moonLongitude")
        locationNotice = "系统定位 · 本地月面朝向"
        refresh()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        locationNotice = "暂时无法定位，可在设置中手动填写位置"
        refresh()
    }

    private func readSiteTitle() {
        guard let project = project() else { siteTitle = ""; return }
        let config = project.appendingPathComponent("_config.yml")
        let stamp = config.path + String(describing: try? config.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
        guard stamp != titleStamp, !readingTitle else { return }
        readingTitle = true
        let module = studio.appendingPathComponent("node_modules/js-yaml").path
        Task {
            let title = await Task.detached(priority: .utility) { () -> String? in
                let task = Process(), output = Pipe()
                task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                var env = ProcessInfo.processInfo.environment
                env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:" + (env["PATH"] ?? "")
                task.environment = env
                task.arguments = ["node", "-e", "const fs=require('fs');const y=require(process.argv[1]);process.stdout.write(JSON.stringify(String(y.safeLoad(fs.readFileSync(process.argv[2],'utf8')).title||'')));", module, config.path]
                task.standardOutput = output; task.standardError = FileHandle.nullDevice
                do {
                    try task.run()
                    let data = output.fileHandleForReading.readDataToEndOfFile()
                    task.waitUntilExit()
                    guard task.terminationStatus == 0 else { return nil }
                    return try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as? String
                } catch { return nil }
            }.value
            readingTitle = false
            guard self.project() == project else { return }
            titleStamp = stamp
            siteTitle = title ?? project.lastPathComponent
            refresh()
        }
    }

    @objc func showSettings() {
        let alert = NSAlert()
        alert.messageText = "月相与菜单栏显示"
        alert.informativeText = "月相按当前时间计算；位置决定月面的朝向，白天也会显示。位置仅在本机计算，不上传到网站。"
        let name = NSPopUpButton(), icon = NSPopUpButton()
        name.addItems(withTitles: ["不显示名称（默认）", "Moonlit Desk", "当前网站名称"])
        name.selectItem(at: ["none", "app", "site"].firstIndex(of: defaults.string(forKey: "menuNameMode") ?? "none") ?? 0)
        icon.addItems(withTitles: ["实时月相图标（默认）", "自定义图标／表情"])
        icon.selectItem(at: defaults.string(forKey: "menuIconMode") == "custom" ? 1 : 0)
        let symbol = NSTextField(string: defaults.string(forKey: "menuCustomIcon") ?? "✦")
        let auto = NSButton(checkboxWithTitle: "使用系统定位（约每小时更新）", target: nil, action: nil)
        auto.state = automatic ? .on : .off
        let latitude = NSTextField(string: hasLocation ? String(defaults.double(forKey: "moonLatitude")) : "")
        let longitude = NSTextField(string: hasLocation ? String(defaults.double(forKey: "moonLongitude")) : "")
        latitude.placeholderString = "-90 至 90，如 53.35"
        longitude.placeholderString = "-180 至 180，如 -6.26"
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: 390, height: 310)
        for view in [NSTextField(labelWithString: "名称"), name, NSTextField(labelWithString: "图标"), icon,
                     symbol, auto, NSTextField(labelWithString: "纬度（关闭系统定位后使用）"), latitude,
                     NSTextField(labelWithString: "经度"), longitude] {
            stack.addArrangedSubview(view)
            view.widthAnchor.constraint(equalToConstant: 390).isActive = true
        }
        alert.accessoryView = stack
        alert.addButton(withTitle: "保存"); alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        if auto.state == .off {
            guard let lat = Double(latitude.stringValue), let lng = Double(longitude.stringValue),
                  lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else {
                let error = NSAlert(); error.messageText = "请填写有效的纬度和经度"; error.runModal(); return
            }
            defaults.set(lat, forKey: "moonLatitude"); defaults.set(lng, forKey: "moonLongitude")
        }
        let value = symbol.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        defaults.set(["none", "app", "site"][name.indexOfSelectedItem], forKey: "menuNameMode")
        defaults.set(icon.indexOfSelectedItem == 1 ? "custom" : "moon", forKey: "menuIconMode")
        defaults.set(value.isEmpty ? "✦" : String(value.prefix(2)), forKey: "menuCustomIcon")
        defaults.set(auto.state == .on, forKey: "moonAutoLocation")
        manager.stopUpdatingLocation()
        requestLocation(); refresh()
    }
}
