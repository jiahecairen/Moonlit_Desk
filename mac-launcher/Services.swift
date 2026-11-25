import Foundation
import CryptoKit

struct BackupService {
    let project: URL

    func create(in destination: URL) throws -> URL {
        let files = FileManager.default
        let projectPath = project.resolvingSymlinksInPath().standardizedFileURL.path
        let destinationPath = destination.resolvingSymlinksInPath().standardizedFileURL.path
        guard destinationPath != projectPath, !destinationPath.hasPrefix(projectPath + "/") else {
            throw CocoaError(.fileWriteInvalidFileName, userInfo: [
                NSLocalizedDescriptionKey: "请选择博客目录以外的备份位置。"
            ])
        }
        guard files.fileExists(atPath: project.appendingPathComponent("_config.yml").path),
              files.fileExists(atPath: project.appendingPathComponent("package.json").path) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [
                NSLocalizedDescriptionKey: "找不到 Hexo 配置或文章目录。"
            ])
        }

        func fingerprint() throws -> String {
            let excluded = Set(["node_modules", "public", ".git", ".deploy_git", ".editor", "db.json", ".DS_Store"])
            guard let enumerator = files.enumerator(at: project, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]) else {
                throw CocoaError(.fileReadUnknown)
            }
            var paths: [URL] = []
            while let file = enumerator.nextObject() as? URL {
                if excluded.contains(file.lastPathComponent) {
                    enumerator.skipDescendants()
                    continue
                }
                let values = try file.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                if values.isSymbolicLink == true || values.isDirectory != true { paths.append(file) }
            }
            var hasher = SHA256()
            for file in paths.sorted(by: { $0.path < $1.path }) {
                let relative = String(file.path.dropFirst(project.path.count))
                hasher.update(data: Data(relative.utf8))
                hasher.update(data: Data([0]))
                if try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                    hasher.update(data: Data(try files.destinationOfSymbolicLink(atPath: file.path).utf8))
                } else {
                    hasher.update(data: Data(SHA256.hash(data: try Data(contentsOf: file))))
                }
                hasher.update(data: Data([0]))
            }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        }

        let contentHash = try fingerprint()
        try files.createDirectory(at: destination, withIntermediateDirectories: true)
        if let previous = try files.contentsOfDirectory(at: destination, includingPropertiesForKeys: nil)
            .first(where: { $0.lastPathComponent.hasPrefix("Moonlit Desk-") && $0.lastPathComponent.hasSuffix("-" + contentHash + ".zip") }) {
            return previous
        }
        let work = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try files.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: work) }

        let archive = work.appendingPathComponent("backup.zip")
        let log = work.appendingPathComponent("backup.log")
        try Data().write(to: log)
        let output = try FileHandle(forWritingTo: log)
        defer { try? output.close() }

        func run(_ executable: String, _ arguments: [String]) throws {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: executable)
            task.currentDirectoryURL = project
            task.arguments = arguments
            task.standardOutput = output
            task.standardError = output
            try task.run()
            task.waitUntilExit()
            guard task.terminationStatus == 0 else {
                let diagnostic = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
                throw NSError(domain: "Moonlit DeskBackup", code: Int(task.terminationStatus), userInfo: [
                    NSLocalizedDescriptionKey: diagnostic.isEmpty ? "备份命令执行失败。" : String(diagnostic.suffix(1000))
                ])
            }
        }

        try run("/usr/bin/zip", ["-qry", archive.path, ".", "-x",
            "node_modules/*", "node_modules/", "public/*", "public/", "db.json",
            ".git/*", ".git/", ".deploy_git/*", ".deploy_git/", ".editor/*", ".editor/", "*/.DS_Store", ".DS_Store"])
        try run("/usr/bin/unzip", ["-tq", archive.path])

        let stamp = Date().formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false)
            .timeSeparator(.omitted))
        guard try fingerprint() == contentHash else {
            throw NSError(domain: "Moonlit DeskBackup", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "备份期间博客内容发生变化，请稍后重试。"
            ])
        }
        let suffix = contentHash
        let result = destination.appendingPathComponent("Moonlit Desk-\(stamp)-\(suffix).zip")
        let staging = destination.appendingPathComponent(".\(result.lastPathComponent).partial")
        defer { try? files.removeItem(at: staging) }
        try files.copyItem(at: archive, to: staging)
        try files.moveItem(at: staging, to: result)
        return result
    }
}

enum HexoServer {
    static let address = URL(string: "http://127.0.0.1:4000/")!

    static func start(project: URL, log: URL, port: Int = 4000, script: String? = nil) throws -> Process {
        let entry = script ?? "node_modules/hexo-cli/bin/hexo"
        let cli = entry.hasPrefix("/") ? URL(fileURLWithPath: entry) : project.appendingPathComponent(entry)
        guard FileManager.default.fileExists(atPath: cli.path) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [
                NSLocalizedDescriptionKey: "找不到 Hexo。请先在博客目录安装 npm 依赖。"
            ])
        }

        let config = ProcessInfo.processInfo.environment
        let nodePaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
            + (config["PATH"] ?? "").split(separator: ":").map(String.init)
        guard let node = nodePaths.map({ $0 + "/node" }).first(where: {
            FileManager.default.isExecutableFile(atPath: $0)
        }) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "找不到 Node.js。"])
        }

        if !FileManager.default.fileExists(atPath: log.path) { try Data().write(to: log) }
        let output = try FileHandle(forWritingTo: log)
        defer { try? output.close() }
        try output.seekToEnd()
        let task = Process()
        task.executableURL = URL(fileURLWithPath: node)
        task.currentDirectoryURL = project
        task.arguments = script == nil ? [cli.path, "server", "--ip", "127.0.0.1", "--port", String(port)] : [cli.path]
        task.standardOutput = output
        task.standardError = output
        try task.run()
        return task
    }

    static func portOccupied() -> Bool {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ["-nP", "-iTCP:4000", "-sTCP:LISTEN"]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            task.waitUntilExit()
            return task.terminationStatus == 0
        } catch { return false }
    }
}

enum StudioSettings {
    static let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Moonlit Desk/settings.json")

    static func load() -> [String: Any] {
        guard let data = try? Data(contentsOf: url),
              let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return result
    }

    static func save(_ value: [String: Any]) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
