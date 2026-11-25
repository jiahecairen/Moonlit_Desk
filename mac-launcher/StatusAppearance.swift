import AppKit

@MainActor
final class StatusAppearance: NSObject {
    private let item: NSStatusItem
    private let defaults = UserDefaults.standard
    private let studio: URL
    private let project: () -> URL?
    private var siteTitle = ""
    private var titleStamp = ""
    private var readingTitle = false
    private var locationNotice = ""
    private var lastIPAttempt = Date.distantPast
    private var ipTask: Task<Void, Never>?
    private var ipGeneration = 0
    private var locationMode: String { defaults.string(forKey: "moonLocationMode") ?? "timezone" }
    private let zoneTable: String = {
        // Prefer macOS's table and fall back to the bundled public-domain IANA table.
        let urls = [URL(fileURLWithPath: "/usr/share/zoneinfo/zone.tab"), Bundle.main.resourceURL?.appendingPathComponent("zone.tab")].compactMap { $0 }
        return urls.compactMap { try? String(contentsOf: $0, encoding: .utf8) }.first ?? ""
    }()

    private var timeZoneLocation: MoonLocation? {
        let identifier = TimeZone.autoupdatingCurrent.identifier
        let canonical = URL(fileURLWithPath: "/usr/share/zoneinfo/" + identifier).resolvingSymlinksInPath().path
            .components(separatedBy: "zoneinfo/").last ?? identifier
        return MoonLocation.fromTimeZone(identifier: identifier, table: zoneTable)
            ?? MoonLocation.fromTimeZone(identifier: canonical, table: zoneTable)
    }

    private var location: MoonLocation? {
        if locationMode == "manual" {
            guard defaults.object(forKey: "moonManualLatitude") != nil,
                  defaults.object(forKey: "moonManualLongitude") != nil else { return nil }
            return MoonLocation.valid(latitude: defaults.double(forKey: "moonManualLatitude"),
                longitude: defaults.double(forKey: "moonManualLongitude"), label: "手动位置")
        }
        if locationMode == "ip", let stamp = defaults.object(forKey: "moonIPDate") as? Date,
           Date().timeIntervalSince(stamp) >= 0, Date().timeIntervalSince(stamp) < 21600,
           let lat = defaults.object(forKey: "moonIPLatitude") as? Double,
           let lon = defaults.object(forKey: "moonIPLongitude") as? Double {
            return MoonLocation.valid(latitude: lat, longitude: lon,
                label: defaults.string(forKey: "moonIPLabel") ?? "IP 城市估算")
        }
        return timeZoneLocation
    }

    init(item: NSStatusItem, studio: URL, project: @escaping () -> URL?) {
        self.item = item
        self.studio = studio
        self.project = project
        super.init()
        // Older automatic CoreLocation choices migrate to the no-permission default.
        if defaults.string(forKey: "moonLocationMode") == nil {
            if defaults.object(forKey: "moonAutoLocation") as? Bool == false,
               let lat = defaults.object(forKey: "moonLatitude"), let lon = defaults.object(forKey: "moonLongitude") {
                defaults.set(lat, forKey: "moonManualLatitude"); defaults.set(lon, forKey: "moonManualLongitude")
                defaults.set("manual", forKey: "moonLocationMode")
            } else { defaults.set("timezone", forKey: "moonLocationMode") }
        }
    }

    func start() { refresh() }
    func stop() { ipTask?.cancel() }

    func refresh() {
        readSiteTitle()
        let position = location
        let lunar = LunarPhase.calculate(date: Date(), latitude: position?.latitude, longitude: position?.longitude)
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
        let description = position.map { String(format: "%.2f°, %.2f° · %@", $0.latitude, $0.longitude, $0.label) } ?? "未取得估算位置 · 标准月相朝向"
        button.toolTip = "\(lunar.name) · 照明 \(Int((lunar.fraction * 100).rounded()))%\n\(description)\n\(locationNotice)\n按当前时间计算，白天及地平线下也显示"
        button.setAccessibilityLabel("\(lunar.name)，照明 \(Int((lunar.fraction * 100).rounded()))%，\(name.isEmpty ? "博客工具" : name)")
        refreshIPIfNeeded()
    }

    private func refreshIPIfNeeded() {
        guard locationMode == "ip", ipTask == nil else { return }
        if let date = defaults.object(forKey: "moonIPDate") as? Date,
           Date().timeIntervalSince(date) >= 0, Date().timeIntervalSince(date) < 21600 { return }
        guard Date().timeIntervalSince(lastIPAttempt) >= 3600 else { return }
        lastIPAttempt = Date()
        locationNotice = "正在查询 IP 位置；暂用系统时区估算"
        let generation = ipGeneration
        ipTask = Task { [weak self] in
            guard let self else { return }
            var request = URLRequest(url: URL(string: "https://ipapi.co/json/")!)
            request.timeoutInterval = 6
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForResource = 8
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); if self.ipGeneration == generation { self.ipTask = nil } }
            do {
                let (data, response) = try await session.data(for: request)
                try Task.checkCancellation()
                guard self.locationMode == "ip", self.ipGeneration == generation, (response as? HTTPURLResponse)?.statusCode == 200 else {
                    throw URLError(.badServerResponse)
                }
                let result = try MoonLocation.fromIPResponse(data)
                self.defaults.set(result.latitude, forKey: "moonIPLatitude")
                self.defaults.set(result.longitude, forKey: "moonIPLongitude")
                self.defaults.set(result.label, forKey: "moonIPLabel")
                self.defaults.set(Date(), forKey: "moonIPDate")
                self.locationNotice = "IP 为近似位置，VPN／代理可能影响结果"
            } catch {
                guard self.locationMode == "ip", self.ipGeneration == generation, !Task.isCancelled else { return }
                self.locationNotice = "IP 定位不可用，已回退系统时区估算"
            }
            self.refresh()
        }
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
        alert.informativeText = "月相按当前时间计算；位置决定月面的朝向，白天也会显示。默认根据系统时区估算，不联网、不请求定位权限。可选 IP 定位或手动经纬度。"
        let name = NSPopUpButton(), icon = NSPopUpButton()
        name.addItems(withTitles: ["不显示名称（默认）", "Moonlit Desk", "当前网站名称"])
        name.selectItem(at: ["none", "app", "site"].firstIndex(of: defaults.string(forKey: "menuNameMode") ?? "none") ?? 0)
        icon.addItems(withTitles: ["实时月相图标（默认）", "自定义图标／表情"])
        icon.selectItem(at: defaults.string(forKey: "menuIconMode") == "custom" ? 1 : 0)
        let symbol = NSTextField(string: defaults.string(forKey: "menuCustomIcon") ?? "✦")
        let mode = NSPopUpButton()
        mode.addItems(withTitles: ["系统时区估算（默认，无弹窗、不联网）", "IP 城市定位（无弹窗，需要联网）", "手动填写经纬度（无弹窗、不联网）"])
        mode.selectItem(at: ["timezone", "ip", "manual"].firstIndex(of: locationMode) ?? 0)
        let latitude = NSTextField(string: defaults.object(forKey: "moonManualLatitude") != nil ? String(defaults.double(forKey: "moonManualLatitude")) : "")
        let longitude = NSTextField(string: defaults.object(forKey: "moonManualLongitude") != nil ? String(defaults.double(forKey: "moonManualLongitude")) : "")
        latitude.placeholderString = "-90 至 90，如 53.35"
        longitude.placeholderString = "-180 至 180，如 -6.26"
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: 390, height: 365)
        for view in [NSTextField(labelWithString: "名称"), name, NSTextField(labelWithString: "图标"), icon,
                     symbol, NSTextField(labelWithString: "位置来源"), mode, NSTextField(labelWithString: "纬度（仅手动模式使用）"), latitude,
                     NSTextField(labelWithString: "经度"), longitude] {
            stack.addArrangedSubview(view)
            view.widthAnchor.constraint(equalToConstant: 390).isActive = true
        }
        let note = NSTextField(wrappingLabelWithString: "IP 模式会访问 ipapi.co，让服务商看到出口 IP；不发送文章、网站配置或 GPS 坐标。时区位置是代表城市，并非当前位置。")
        note.font = .systemFont(ofSize: 11); note.textColor = .secondaryLabelColor
        note.widthAnchor.constraint(equalToConstant: 390).isActive = true
        stack.addArrangedSubview(note)
        alert.accessoryView = stack
        alert.addButton(withTitle: "保存"); alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        if mode.indexOfSelectedItem == 2 {
            guard let lat = Double(latitude.stringValue), let lng = Double(longitude.stringValue),
                  lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else {
                let error = NSAlert(); error.messageText = "请填写有效的纬度和经度"; error.runModal(); return
            }
            defaults.set(lat, forKey: "moonManualLatitude"); defaults.set(lng, forKey: "moonManualLongitude")
        }
        let value = symbol.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        defaults.set(["none", "app", "site"][name.indexOfSelectedItem], forKey: "menuNameMode")
        defaults.set(icon.indexOfSelectedItem == 1 ? "custom" : "moon", forKey: "menuIconMode")
        defaults.set(value.isEmpty ? "✦" : String(value.prefix(2)), forKey: "menuCustomIcon")
        ipGeneration += 1
        ipTask?.cancel()
        ipTask = nil
        defaults.set(["timezone", "ip", "manual"][mode.indexOfSelectedItem], forKey: "moonLocationMode")
        locationNotice = ""
        lastIPAttempt = .distantPast
        refresh()
    }
}
