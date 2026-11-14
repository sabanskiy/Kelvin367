using FireMap.Web.Models;

namespace FireMap.Web.Services;

/// <summary>
/// A source of hot spots shown as one map layer.
/// To add a layer (e.g. the team's harmonized data): implement this interface and register it in
/// Program.cs with <c>builder.Services.AddSingleton&lt;IHotspotProvider, MyProvider&gt;()</c>.
/// The frontend picks it up automatically from /api/layers.
/// </summary>
public interface IHotspotProvider
{
    LayerDescriptor Layer { get; }

    /// <summary>Dates for which this layer has data, or null if unknown.</summary>
    Task<DateRange?> GetCoverageAsync(CancellationToken ct);

    /// <summary>
    /// Return hot spots inside <see cref="HotspotRequest.Area"/>'s envelope (at least) for the date range.
    /// Exact polygon/date filtering is done by the caller.
    /// </summary>
    Task<HotspotBatch> GetAsync(HotspotRequest request, CancellationToken ct);
}

public sealed class HotspotProviderRegistry(IEnumerable<IHotspotProvider> providers)
{
    private readonly Dictionary<string, IHotspotProvider> _byId =
        providers.ToDictionary(p => p.Layer.Id, StringComparer.OrdinalIgnoreCase);

    public IReadOnlyCollection<IHotspotProvider> All => _byId.Values;

    public IHotspotProvider Get(string layerId) =>
        _byId.TryGetValue(layerId, out var p) ? p : throw new KeyNotFoundException($"Unknown layer '{layerId}'.");
}

/// <summary>Request would hit too many upstream tiles; caller should zoom in or shrink the range (HTTP 422).</summary>
public sealed class QueryTooLargeException(string message) : Exception(message);
