import Foundation

@main
struct LunarPhaseTests {
    static func main() {
        // Fixtures generated with SunCalc 1.9.0, the source of the ported formulas.
        let fixtures: [(String, Double, Double, Double, Double, Double)] = [
            ("2024-04-08T18:21:00Z", 53.35, -6.26, 0.00011015357731108955, 0.0033408532837719274, -2.733029051724296),
            ("2024-03-25T07:00:00Z", 53.35, -6.26, 0.9999425884123632, 0.5024118709208443, -0.14143873677704477),
            ("2026-11-25T12:00:00Z", 53.35, -6.26, 0.9886014636685404, 0.5340489085418568, 0.9036739243143779),
            ("2026-11-25T12:00:00Z", -33.87, 151.21, 0.9886014636685404, 0.5340489085418568, 3.637709056746476)
        ]
        let formatter = ISO8601DateFormatter()
        for (date, lat, lon, fraction, phase, orientation) in fixtures {
            let time = formatter.date(from: date)!
            let actual = LunarPhase.calculate(date: time, latitude: lat, longitude: lon)
            precondition(abs(actual.fraction - fraction) < 1e-9, "Illumination: \(date)")
            precondition(abs(actual.phase - phase) < 1e-9, "Phase: \(date)")
            precondition(abs(actual.orientation - orientation) < 1e-9, "Orientation: \(lat),\(lon)")
            let fallback = LunarPhase.calculate(date: time)
            precondition(fallback.phase == actual.phase && fallback.fraction == actual.fraction)
            precondition(fallback.orientation.isFinite)
            // Without a location, a northern standard view lights the right side
            // while waxing and the left side while waning.
            precondition((cos(fallback.screenRotation) > 0) == (fallback.phase < 0.5))
        }
        precondition(LunarPhase.calculate(date: formatter.date(from: fixtures[0].0)!).name == "新月")
        precondition(LunarPhase.calculate(date: formatter.date(from: fixtures[1].0)!).name == "满月")
        print("Passed lunar phase, illumination, daylight, location and fallback fixtures.")
    }
}
