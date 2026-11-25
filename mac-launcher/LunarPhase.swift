import Foundation

// Sun/Moon coordinate and illumination formulas adapted from SunCalc 1.9.0.
// Copyright (c) 2014 Vladimir Agafonkin. See THIRD_PARTY_NOTICES.md (BSD-2-Clause).
struct LunarPhase {
    let fraction: Double
    let phase: Double
    // Angle anticlockwise from the top of the observer's sky to the illuminated limb.
    let orientation: Double

    var screenRotation: Double { .pi / 2 + orientation }

    var index: Int { Int((phase * 8).rounded()) % 8 }
    var name: String { ["新月", "娥眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"][index] }

    static func calculate(date: Date, latitude: Double? = nil, longitude: Double? = nil) -> LunarPhase {
        let rad = Double.pi / 180
        let d = date.timeIntervalSince1970 / 86400 + 2440587.5 - 2451545
        let obliquity = 23.4397 * rad
        func coordinates(_ l: Double, _ b: Double) -> (ra: Double, dec: Double) {
            (atan2(sin(l) * cos(obliquity) - tan(b) * sin(obliquity), cos(l)),
             asin(sin(b) * cos(obliquity) + cos(b) * sin(obliquity) * sin(l)))
        }
        let anomaly = rad * (357.5291 + 0.98560028 * d)
        let center = rad * (1.9148 * sin(anomaly) + 0.02 * sin(2 * anomaly) + 0.0003 * sin(3 * anomaly))
        let sun = coordinates(anomaly + center + rad * 102.9372 + .pi, 0)
        let moonAnomaly = rad * (134.963 + 13.064993 * d)
        let moon = coordinates(rad * (218.316 + 13.176396 * d) + rad * 6.289 * sin(moonAnomaly),
                               rad * 5.128 * sin(rad * (93.272 + 13.229350 * d)))
        let distance = 385001 - 20905 * cos(moonAnomaly)
        let separation = acos(max(-1, min(1, sin(sun.dec) * sin(moon.dec) + cos(sun.dec) * cos(moon.dec) * cos(sun.ra - moon.ra))))
        let incidence = atan2(149598000 * sin(separation), distance - 149598000 * cos(separation))
        let angle = atan2(cos(sun.dec) * sin(sun.ra - moon.ra),
                          sin(sun.dec) * cos(moon.dec) - cos(sun.dec) * sin(moon.dec) * cos(sun.ra - moon.ra))
        let phase = 0.5 + 0.5 * incidence * (angle < 0 ? -1 : 1) / .pi
        var orientation = phase < 0.5 ? -Double.pi / 2 : Double.pi / 2
        if let latitude, let longitude {
            let hourAngle = rad * (280.16 + 360.9856235 * d + longitude) - moon.ra
            let parallactic = atan2(sin(hourAngle), tan(latitude * rad) * cos(moon.dec) - sin(moon.dec) * cos(hourAngle))
            orientation = angle - parallactic
        }
        return LunarPhase(fraction: (1 + cos(incidence)) / 2, phase: phase, orientation: orientation)
    }
}
