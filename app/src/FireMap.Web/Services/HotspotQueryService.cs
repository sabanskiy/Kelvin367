using FireMap.Web.Models;
using FireMap.Web.Services.Firms;
using FireMap.Web.Services.Geo;
using Microsoft.Extensions.Options;

namespace FireMap.Web.Services;

public sealed record LayerQueryResult(IHotspotProvider Provider, IReadOnlyList<Hotspot> Items, bool Partial, IReadOnlyList<string> Missing);

/// <summary>Validates the time range, calls the provider and applies exact area/date filtering — the same for every layer.</summary>
public sealed class HotspotQueryService(HotspotProviderRegistry registry, IOptions<ApiOptions> api, TimeProvider time)
{
    public void ValidateRange(DateOnly from, DateOnly to)
    {
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        if (from == default || to == default) throw new ArgumentException("'from' and 'to' (yyyy-MM-dd) are required.");
        if (to < from) throw new ArgumentException("'to' must not be before 'from'.");
        if (to > today.AddDays(1)) throw new ArgumentException($"'to' cannot be in the future (today is {today:yyyy-MM-dd} UTC).");
        int days = to.DayNumber - from.DayNumber + 1;
        if (days > api.Value.MaxRangeDays)
            throw new ArgumentException($"Time range is {days} days; maximum is {api.Value.MaxRangeDays}.");
    }

    public async Task<LayerQueryResult> QueryAsync(string layerId, QueryArea area, DateOnly from, DateOnly to, CancellationToken ct)
    {
        ValidateRange(from, to);
        var provider = registry.Get(layerId);
        var batch = await provider.GetAsync(new HotspotRequest(area.Geometry, from, to), ct);
        var items = batch.Items
            .Where(h => h.AcqDate >= from && h.AcqDate <= to && area.Contains(h.Lon, h.Lat))
            .ToList();
        return new LayerQueryResult(provider, items, batch.Partial, batch.Missing);
    }
}
