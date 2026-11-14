namespace FireMap.Web.Models;

/// <summary>
/// One fire detection, normalized across sensors (MODIS 1 km, VIIRS 375 m) and data sources
/// (FIRMS NRT/SP, team's harmonized output). Everything the map and the stats need goes here.
/// </summary>
public sealed record Hotspot(
    double Lat,
    double Lon,
    DateTime AcquiredUtc,
    string Satellite,
    string Instrument,
    string LayerId,
    string SourceId,
    int? ConfidencePct,
    string ConfidenceClass,
    double? Frp,
    double? BrightnessK,
    char DayNight,
    double? ScanKm,
    double? TrackKm,
    int? Type)
{
    public DateOnly AcqDate => DateOnly.FromDateTime(AcquiredUtc);
}

public static class ConfidenceClasses
{
    public const string Low = "low";
    public const string Nominal = "nominal";
    public const string High = "high";
}
