using FireMap.Web.Models;

namespace FireMap.Web.Services.Firms;

/// <summary>
/// Offline stand-in used when no FIRMS MAP_KEY is configured. Serves real FIRMS extracts from
/// Data/sample/{layerId}.csv (Europe, a few days in Oct/Nov 2026).
/// </summary>
public sealed class SampleHotspotProvider : IHotspotProvider
{
    private readonly Lazy<List<Hotspot>> _data;

    public SampleHotspotProvider(FirmsSensor sensor, IWebHostEnvironment env)
    {
        Layer = sensor.Layer with { Description = sensor.Layer.Description + " (sample data — no MAP_KEY configured)" };
        var path = Path.Combine(env.ContentRootPath, "Data", "sample", $"{sensor.Layer.Id}.csv");
        _data = new Lazy<List<Hotspot>>(() =>
            File.Exists(path) ? FirmsCsvParser.Parse(File.ReadAllText(path), sensor.Layer.Id, sensor.NrtSourceId) : []);
    }

    public LayerDescriptor Layer { get; }

    public Task<DateRange?> GetCoverageAsync(CancellationToken ct)
    {
        var d = _data.Value;
        return Task.FromResult<DateRange?>(d.Count == 0 ? null : new DateRange(d.Min(h => h.AcqDate), d.Max(h => h.AcqDate)));
    }

    public Task<HotspotBatch> GetAsync(HotspotRequest request, CancellationToken ct)
    {
        var env = request.Area.EnvelopeInternal;
        var items = _data.Value
            .Where(h => h.AcqDate >= request.From && h.AcqDate <= request.To && env.Contains(h.Lon, h.Lat))
            .ToList();
        return Task.FromResult(HotspotBatch.Complete(items));
    }
}
