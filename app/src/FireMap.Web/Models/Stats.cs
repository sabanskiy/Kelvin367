namespace FireMap.Web.Models;

public sealed class StatsRequest
{
    public string[] Layers { get; set; } = [];
    /// <summary>[west, south, east, north]</summary>
    public double[]? Bbox { get; set; }
    /// <summary>ISO 3166-1 alpha-3 (Natural Earth ADM0_A3).</summary>
    public string? Country { get; set; }
    public DateOnly From { get; set; }
    public DateOnly To { get; set; }
}

public sealed record AreaInfo(string Kind, string Name, string? Iso3, double[] Bbox, double AreaKm2);

public sealed record StatsResult(
    AreaInfo Area,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<LayerStats> Layers,
    IReadOnlyList<SensorComparison> Comparisons,
    bool Partial);

public sealed record LayerStats(
    string LayerId,
    string Name,
    string Color,
    int Count,
    int DayCount,
    int NightCount,
    ConfidenceBreakdown Confidence,
    FrpStats Frp,
    double DensityPer1000Km2,
    IReadOnlyList<DailyStat> Daily,
    bool Partial,
    IReadOnlyList<string> Missing);

public sealed record ConfidenceBreakdown(int Low, int Nominal, int High);

public sealed record FrpStats(double Sum, double Mean, double Median, double Max);

public sealed record DailyStat(DateOnly Date, int Count, double FrpSum);

/// <summary>Layer A vs layer B, e.g. VIIRS NOAA-20 vs MODIS — the core of the harmonization question.</summary>
public sealed record SensorComparison(string LayerA, string LayerB, double? CountRatio, double? FrpRatio);
