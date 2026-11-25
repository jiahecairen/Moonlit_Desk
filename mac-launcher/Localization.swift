import Foundation

enum L10n {
    static var language: String { StudioSettings.load()["language"] as? String == "zh" ? "zh" : "en" }
    private static let strings: [String: String] = {
        guard let file = Bundle.main.resourceURL?.appendingPathComponent("editor/ui-strings.json"),
              let data = try? Data(contentsOf: file),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
        return value
    }()
    static func text(_ source: String) -> String {
        guard language == "en" else { return source }
        if let translated = strings[source] { return translated }
        var result = source
        for key in strings.keys.sorted(by: { $0.count > $1.count }) where key.count > 1 {
            result = result.replacingOccurrences(of: key, with: strings[key]!)
        }
        return result
    }
}
