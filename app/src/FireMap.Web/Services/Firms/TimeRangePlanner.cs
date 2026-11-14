using FireMap.Web.Models;

namespace FireMap.Web.Services.Firms;

/// <summary>One upstream FIRMS area call (per tile): <c>/api/area/csv/{key}/{SourceId}/{bbox}/{Days}/{Start}</c>.</summary>
public sealed record FirmsFetchPlan(string SourceId, DateOnly Start, int Days, bool IsNrt)
{
    public DateOnly End => Start.AddDays(Days - 1);

    /// <summary>Tile size is part of the key: tile (2,3) means a different area on a 10° and a 30° grid.</summary>
    public string CacheKey(TileKey tile, double tileSizeDeg) =>
        string.Create(System.Globalization.CultureInfo.InvariantCulture,
            $"firms:{SourceId}:{Start:yyyy-MM-dd}_{Days}d:{tileSizeDeg:0.##}deg_{tile}");
}

public static class TimeRangePlanner
{
    /// <summary>Chunks are aligned to this epoch, not to the user's "from", so overlapping ranges share cache entries.</summary>
    public static readonly DateOnly Epoch = new(2000, 1, 1);

    public static DateOnly ChunkStart(DateOnly d, int chunkDays)
    {
        int offset = d.DayNumber - Epoch.DayNumber;
        int idx = (int)Math.Floor(offset / (double)chunkDays);
        return Epoch.AddDays(idx * chunkDays);
    }

    /// <summary>
    /// Split [from, to] into epoch-aligned chunks of <paramref name="chunkDays"/> and, within each chunk,
    /// pick SP (archive) where available, else NRT. Days with no data in either source are skipped.
    /// Whole chunks are fetched even if the user asked for part of one; trimming happens after caching.
    /// </summary>
    public static IReadOnlyList<FirmsFetchPlan> Plan(
        DateOnly from, DateOnly to, FirmsSensor sensor,
        IReadOnlyDictionary<string, DateRange> availability, DateOnly todayUtc, int chunkDays = 5)
    {
        if (to < from) throw new ArgumentException("'to' must not be before 'from'.");

        var sp = availability.TryGetValue(sensor.SpSourceId, out var s) ? s : (DateRange?)null;
        var nrt = availability.TryGetValue(sensor.NrtSourceId, out var n) ? n : (DateRange?)null;

        // Availability is cached for hours, so treat an *active* NRT feed as reaching today.
        if (nrt is { } nr && nr.Max >= todayUtc.AddDays(-2))
            nrt = nr with { Max = todayUtc };

        // Unknown availability (e.g. the call failed): assume NRT covers the last 60 days, SP the rest.
        if (sp is null && nrt is null)
        {
            nrt = new DateRange(todayUtc.AddDays(-60), todayUtc);
            sp = new DateRange(Epoch, todayUtc.AddDays(-61));
        }

        var plans = new List<FirmsFetchPlan>();
        for (var chunk = ChunkStart(from, chunkDays); chunk <= to; chunk = chunk.AddDays(chunkDays))
        {
            string? currentSource = null;
            DateOnly segStart = default;
            int segDays = 0;

            for (int i = 0; i < chunkDays; i++)
            {
                var day = chunk.AddDays(i);
                string? source = sp is { } spr && spr.Contains(day) ? sensor.SpSourceId
                               : nrt is { } nrr && nrr.Contains(day) ? sensor.NrtSourceId
                               : null;

                if (source == currentSource && source is not null)
                {
                    segDays++;
                    continue;
                }
                Flush();
                currentSource = source;
                segStart = day;
                segDays = source is null ? 0 : 1;
            }
            Flush();

            void Flush()
            {
                if (currentSource is not null && segDays > 0)
                    plans.Add(new FirmsFetchPlan(currentSource, segStart, segDays, currentSource == sensor.NrtSourceId));
            }
        }
        return plans;
    }

    /// <summary>
    /// Archive data and NRT data older than <paramref name="nrtSettleDays"/> never change → cache long.
    /// Recent NRT keeps receiving new overpasses → cache briefly.
    /// </summary>
    public static TimeSpan CacheTtl(FirmsFetchPlan plan, DateOnly todayUtc, FirmsOptions o) =>
        !plan.IsNrt || plan.End < todayUtc.AddDays(-o.NrtSettleDays)
            ? TimeSpan.FromDays(o.ImmutableTtlDays)
            : TimeSpan.FromMinutes(o.RecentTtlMinutes);
}
