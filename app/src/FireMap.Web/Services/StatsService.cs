using FireMap.Web.Models;
using FireMap.Web.Services.Geo;

namespace FireMap.Web.Services;

/// <summary>
/// Aggregations for a selected area. This is the place to add harmonization-specific metrics
/// (e.g. MODIS-equivalent counts from VIIRS) once the team's algorithm is ready.
/// </summary>
public sealed class StatsService(HotspotQueryService query, AreaResolver areas)
{
    public async Task<StatsResult> ComputeAsync(StatsRequest req, CancellationToken ct)
    {
        if (req.Layers.Length == 0) throw new ArgumentException("Select at least one layer.");
        query.ValidateRange(req.From, req.To);
        var area = areas.Resolve(req.Bbox, req.Country);

        var results = await Task.WhenAll(req.Layers.Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(id => query.QueryAsync(id, area, req.From, req.To, ct)));

        var layers = results.Select(r => Summarize(r, area, req.From, req.To)).ToList();
        return new StatsResult(area.ToInfo(), req.From, req.To, layers, Compare(results, layers), layers.Any(l => l.Partial));
    }

    public static LayerStats Summarize(LayerQueryResult r, QueryArea area, DateOnly from, DateOnly to)
    {
        var items = r.Items;
        var frp = items.Where(h => h.Frp is not null).Select(h => h.Frp!.Value).OrderBy(v => v).ToArray();

        var byDay = items.GroupBy(h => h.AcqDate).ToDictionary(g => g.Key, g => (g.Count(), g.Sum(h => h.Frp ?? 0)));
        var daily = new List<DailyStat>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var (count, sum) = byDay.GetValueOrDefault(d);
            daily.Add(new DailyStat(d, count, Math.Round(sum, 1)));
        }

        return new LayerStats(
            r.Provider.Layer.Id,
            r.Provider.Layer.Name,
            r.Provider.Layer.Color,
            items.Count,
            items.Count(h => h.DayNight == 'D'),
            items.Count(h => h.DayNight == 'N'),
            new ConfidenceBreakdown(
                items.Count(h => h.ConfidenceClass == ConfidenceClasses.Low),
                items.Count(h => h.ConfidenceClass == ConfidenceClasses.Nominal),
                items.Count(h => h.ConfidenceClass == ConfidenceClasses.High)),
            new FrpStats(
                Math.Round(frp.Sum(), 1),
                frp.Length == 0 ? 0 : Math.Round(frp.Average(), 2),
                frp.Length == 0 ? 0 : Math.Round(Median(frp), 2),
                frp.Length == 0 ? 0 : frp[^1]),
            area.AreaKm2 > 0 ? Math.Round(items.Count / area.AreaKm2 * 1000, 3) : 0,
            daily,
            r.Partial,
            r.Missing.Take(20).ToList());
    }

    /// <summary>Every VIIRS layer vs MODIS (and harmonized vs MODIS later): ratio of detections and of total FRP.</summary>
    private static List<SensorComparison> Compare(LayerQueryResult[] results, List<LayerStats> stats)
    {
        var comparisons = new List<SensorComparison>();
        var modisLayer = results.FirstOrDefault(r => r.Provider.Layer.Instrument == "MODIS")?.Provider.Layer.Id;
        var modis = stats.FirstOrDefault(s => s.LayerId == modisLayer);
        if (modis is null) return comparisons;

        foreach (var s in stats.Where(s => s.LayerId != modis.LayerId))
            comparisons.Add(new SensorComparison(
                s.LayerId, modis.LayerId,
                modis.Count == 0 ? null : Math.Round((double)s.Count / modis.Count, 2),
                modis.Frp.Sum == 0 ? null : Math.Round(s.Frp.Sum / modis.Frp.Sum, 2)));
        return comparisons;
    }

    private static double Median(double[] sorted) =>
        sorted.Length % 2 == 1 ? sorted[sorted.Length / 2] : (sorted[sorted.Length / 2 - 1] + sorted[sorted.Length / 2]) / 2;
}
