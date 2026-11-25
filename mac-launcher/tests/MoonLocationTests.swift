import Foundation

@main
struct MoonLocationTests {
    static func main() throws {
        let table = "# fixture\nIE\t+5320-00615\tEurope/Dublin\nAU\t-3352+15113\tAustralia/Sydney\nAQ\t-720041+0023206\tAntarctica/Troll\n"
        let dublin = MoonLocation.fromTimeZone(identifier: "Europe/Dublin", table: table)!
        precondition(abs(dublin.latitude - (53 + 20.0/60)) < 1e-10)
        precondition(dublin.longitude == -6.25)
        precondition(MoonLocation.fromTimeZone(identifier: "Australia/Sydney", table: table)!.latitude < 0)
        precondition(MoonLocation.fromTimeZone(identifier: "UTC", table: table) == nil)
        precondition(abs(MoonLocation.fromTimeZone(identifier: "Antarctica/Troll", table: table)!.latitude + 72 + 41.0/3600) < 1e-10)
        for invalid in ["", "+99-00615", "+5360-00615", "+9100+00000", "+5320-18100", "+532000-0061560"] {
            precondition(MoonLocation.parseCoordinate(invalid) == nil, invalid)
        }
        let ip = try MoonLocation.fromIPResponse(Data("{\"latitude\":53.3,\"longitude\":-6.2,\"city\":\"Example\"}".utf8))
        precondition(ip.latitude == 53.3 && ip.longitude == -6.2)
        for invalid in ["{}", "{\"error\":true}", "{\"latitude\":91,\"longitude\":0}", "{\"latitude\":\"53.3\",\"longitude\":0}"] {
            do { _ = try MoonLocation.fromIPResponse(Data(invalid.utf8)); preconditionFailure("Invalid IP data accepted") }
            catch { }
        }
        let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        precondition(!source.contains("import CoreLocation") && !source.contains("requestWhenInUseAuthorization"))
        print("Passed time zone coordinates, hemispheres, unknown zones, IP responses and no-permission default checks.")
    }
}
