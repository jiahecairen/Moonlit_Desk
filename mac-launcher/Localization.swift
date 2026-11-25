import Foundation

enum L10n {
    private static let languages: [[String: Any]] = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("editor/languages.json"),
              let data = try? Data(contentsOf: url),
              let result = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return result
    }()
    static var supportedCodes: [String] { languages.compactMap { $0["code"] as? String } }
    static var language: String {
        let value = StudioSettings.load()["language"] as? String ?? "en"
        return supportedCodes.contains(value) ? value : "en"
    }
    private static let catalogs: [String: [String: String]] = {
        var result: [String: [String: String]] = [:]
        for language in languages {
            guard let code = language["code"] as? String, let file = language["catalog"] as? String,
                  file == URL(fileURLWithPath: file).lastPathComponent,
                  let url = Bundle.main.resourceURL?.appendingPathComponent("editor/" + file),
                  let data = try? Data(contentsOf: url),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { continue }
            result[code] = value
        }
        return result
    }()
    static func text(_ source: String) -> String {
        let code = language
        if let entry = languages.first(where: { $0["code"] as? String == code }), entry["catalog"] is NSNull { return source }
        let strings = (catalogs["en"] ?? [:]).merging(catalogs[code] ?? [:]) { _, translated in translated }
        if let translated = strings[source] { return translated }
        var result = source
        for key in strings.keys.sorted(by: { $0.count > $1.count }) where key.count > 1 {
            result = result.replacingOccurrences(of: key, with: strings[key]!)
        }
        return result
    }
}
