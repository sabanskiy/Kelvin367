using FireMap.Web.Models;
using Microsoft.Extensions.Options;

namespace FireMap.Web.Services.Firms;

/// <summary>Live NASA FIRMS layer for one sensor. Fans out to (time chunk × grid tile) cached calls.</summary>
public sealed class FirmsHotspotProvider(
    FirmsSensor sensor,
    CachedFirmsClient cached,
    FirmsAvailabilityService availability,
    IOptions<FirmsOptions> options,
    TimeProvider time) : IHotspotProvider
{
    public LayerDescriptor Layer => sensor.Layer;

    public async Task<DateRange?> GetCoverageAsync(CancellationToken ct)
    {
        var avail = await availability.GetAsync(ct);
        var ranges = new[] { sensor.SpSourceId, sensor.NrtSourceId }
            .Where(avail.ContainsKey).Select(id => avail[id]).ToList();
        if (ranges.Count == 0) return null;

        var max = ranges.Max(r => r.Max);
        var today = Today;
        if (max >= today.AddDays(-2)) max = today; // active NRT feed
        return new DateRange(ranges.Min(r => r.Min), max);
    }

    public async Task<HotspotBatch> GetAsync(HotspotRequest request, CancellationToken ct)
    {
        var o = options.Value;
        var tiles = GridTiling.TilesFor(request.Area, o.TileSizeDeg);
        if (tiles.Count > o.MaxTilesPerQuery)
            throw new QueryTooLargeException(
                $"Area covers {tiles.Count} cache tiles of {o.TileSizeDeg}° (max {o.MaxTilesPerQuery}). Zoom in or choose a smaller area.");

        var avail = await availability.GetAsync(ct);
        var plans = TimeRangePlanner.Plan(request.From, request.To, sensor, avail, Today, o.ChunkDays);

        var jobs = plans.SelectMany(p => tiles.Select(t => (Plan: p, Tile: t))).ToList();
        var results = await Task.WhenAll(jobs.Select(async j =>
        {
            try
            {
                var csv = await cached.GetTileCsvAsync(j.Plan, j.Tile, ct);
                return (j, Items: csv is null ? null : FirmsCsvParser.Parse(csv, sensor.Layer.Id, j.Plan.SourceId), Error: (string?)null);
            }
            catch (Exception ex) when (ex is FirmsApiException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                return (j, Items: (List<Hotspot>?)null, Error: ex.Message);
            }
        }));

        var seen = new HashSet<(double, double, DateTime, string)>();
        var items = new List<Hotspot>();
        var missing = new List<string>();
        foreach (var (job, list, _) in results)
        {
            if (list is null)
            {
                missing.Add($"{job.Plan.SourceId} {job.Plan.Start:yyyy-MM-dd}+{job.Plan.Days}d tile {job.Tile}");
                continue;
            }
            foreach (var h in list)
                if (seen.Add((h.Lat, h.Lon, h.AcquiredUtc, h.Satellite))) // tiles share edges
                    items.Add(h);
        }
        return new HotspotBatch(items, missing.Count > 0, missing);
    }

    private DateOnly Today => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
}
