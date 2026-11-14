using NetTopologySuite.Geometries;

namespace FireMap.Web.Models;

/// <summary>Static description of a map layer. Returned by /api/layers; the frontend builds toggles from it.</summary>
public sealed record LayerDescriptor(
    string Id,
    string Name,
    string Group,
    string Color,
    string Instrument,
    int ResolutionM,
    string Description,
    bool DefaultVisible);

/// <summary>Inclusive date range.</summary>
public readonly record struct DateRange(DateOnly Min, DateOnly Max)
{
    public bool Contains(DateOnly d) => d >= Min && d <= Max;
    public int Days => Max.DayNumber - Min.DayNumber + 1;
}

/// <summary>What a provider is asked for. <see cref="Area"/> is in WGS84 lon/lat.</summary>
public sealed record HotspotRequest(Geometry Area, DateOnly From, DateOnly To);

/// <summary>
/// Provider answer. Providers may return points slightly outside the requested area/dates
/// (e.g. whole cache tiles); <c>HotspotQueryService</c> does the exact filtering.
/// </summary>
public sealed record HotspotBatch(IReadOnlyList<Hotspot> Items, bool Partial, IReadOnlyList<string> Missing)
{
    public static HotspotBatch Complete(IReadOnlyList<Hotspot> items) => new(items, false, []);
}
