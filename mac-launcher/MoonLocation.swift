import Foundation

struct MoonLocation {
    let latitude: Double
    let longitude: Double
    let label: String

    static func valid(latitude: Double, longitude: Double, label: String) -> MoonLocation? {
        guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 else { return nil }
        return MoonLocation(latitude: latitude, longitude: longitude, label: label)
    }

    // IANA zone.tab uses ±DDMM[SS]±DDDMM[SS], not decimal degrees.
    static func parseCoordinate(_ text: String) -> (Double, Double)? {
        guard let split = text.dropFirst().firstIndex(where: { $0 == "+" || $0 == "-" }) else { return nil }
        func component(_ value: Substring, degrees: Int) -> Double? {
            guard let sign = value.first, sign == "+" || sign == "-" else { return nil }
            let digits = String(value.dropFirst())
            guard digits.count == degrees + 2 || digits.count == degrees + 4,
                  digits.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let d = Double(digits.prefix(degrees)),
                  let m = Double(digits.dropFirst(degrees).prefix(2)), m < 60 else { return nil }
            let seconds = digits.count == degrees + 4 ? Double(digits.suffix(2))! : 0
            guard seconds < 60 else { return nil }
            return (sign == "-" ? -1 : 1) * (d + m / 60 + seconds / 3600)
        }
        guard let lat = component(text[..<split], degrees: 2), let lon = component(text[split...], degrees: 3),
              valid(latitude: lat, longitude: lon, label: "") != nil else { return nil }
        return (lat, lon)
    }

    static func fromTimeZone(identifier: String = TimeZone.autoupdatingCurrent.identifier, table: String) -> MoonLocation? {
        for line in table.split(separator: "\n") where !line.hasPrefix("#") {
            let fields = line.split(separator: "\t", omittingEmptySubsequences: false)
            guard fields.count >= 3, fields[2] == identifier,
                  let (lat, lon) = parseCoordinate(String(fields[1])) else { continue }
            return MoonLocation(latitude: lat, longitude: lon, label: "系统时区估算 · " + identifier)
        }
        return nil // A UTC offset alone cannot determine latitude or hemisphere.
    }

    static func fromIPResponse(_ data: Data) throws -> MoonLocation {
        guard data.count <= 65536, let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["error"] as? Bool != true,
              let lat = json["latitude"] as? Double, let lon = json["longitude"] as? Double,
              let result = valid(latitude: lat, longitude: lon, label: "IP 城市估算 · " + (json["city"] as? String ?? "未知城市")) else {
            throw NSError(domain: "MoonLocation", code: 1, userInfo: [NSLocalizedDescriptionKey: "IP 定位返回无效位置"])
        }
        return result
    }
}
