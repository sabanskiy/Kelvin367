using FireMap.Web.Models;
using FireMap.Web.Services.Firms;

namespace FireMap.Tests;

public class TimeRangePlannerTests
{
    private static readonly FirmsSensor Noaa20 = FirmsSensor.All.Single(s => s.Layer.Id == "viirs-noaa20");
    private static readonly DateOnly Today = new(2026, 11, 13);

    // Real values from /api/data_availability on 2026-11-13.
    private static readonly Dictionary<string, DateRange> Availability = new()
    {
        ["VIIRS_NOAA20_SP"] = new(new(2018, 4, 1), new(2026, 7, 31)),
        ["VIIRS_NOAA20_NRT"] = new(new(2026, 8, 1), new(2026, 11, 13)),
    };

    private static DateOnly D(int m, int d) => new(2026, m, d);

    [Fact]
    public void Chunks_are_aligned_to_epoch_not_to_user_range()
    {
        var a = TimeRangePlanner.Plan(D(10, 20), D(10, 21), Noaa20, Availability, Today);
        var b = TimeRangePlanner.Plan(D(10, 19), D(10, 22), Noaa20, Availability, Today);

        // Both ranges fall inside the same epoch-aligned chunk → identical upstream request → shared cache entry.
        Assert.Equal(a.Select(p => p.CacheKey(new TileKey(1, 1), 30)), b.Select(p => p.CacheKey(new TileKey(1, 1), 30)));
        Assert.All(a, p => Assert.Equal(0, (p.Start.DayNumber - TimeRangePlanner.Epoch.DayNumber) % 5));
    }

    [Fact]
    public void Twelve_day_range_needs_at_most_four_chunks_of_max_five_days()
    {
        var plans = TimeRangePlanner.Plan(D(10, 1), D(10, 12), Noaa20, Availability, Today);

        Assert.InRange(plans.Count, 3, 4);
        Assert.All(plans, p => Assert.InRange(p.Days, 1, 5));
        // Every requested day is covered exactly once.
        var days = plans.SelectMany(p => Enumerable.Range(0, p.Days).Select(p.Start.AddDays)).ToList();
        Assert.Equal(days.Count, days.Distinct().Count());
        for (var d = D(10, 1); d <= D(10, 12); d = d.AddDays(1)) Assert.Contains(d, days);
    }

    [Fact]
    public void Range_crossing_sp_nrt_boundary_is_split_per_source()
    {
        var plans = TimeRangePlanner.Plan(D(7, 29), D(8, 3), Noaa20, Availability, Today);

        Assert.Contains(plans, p => p.SourceId == "VIIRS_NOAA20_SP" && p.End == D(7, 31));
        Assert.Contains(plans, p => p.SourceId == "VIIRS_NOAA20_NRT" && p.Start == D(8, 1));
        Assert.All(plans, p => Assert.Equal(p.SourceId.EndsWith("_NRT"), p.IsNrt));
    }

    [Fact]
    public void Days_without_any_source_are_skipped()
    {
        var plans = TimeRangePlanner.Plan(new(2018, 3, 28), new(2018, 4, 2), Noaa20, Availability, Today);
        Assert.All(plans, p => Assert.True(p.Start >= new DateOnly(2018, 4, 1)));
    }

    [Fact]
    public void Inverted_range_is_rejected()
    {
        Assert.Throws<ArgumentException>(() => TimeRangePlanner.Plan(D(10, 5), D(10, 1), Noaa20, Availability, Today));
    }

    [Fact]
    public void Ttl_is_long_for_archive_and_settled_nrt_short_for_recent_nrt()
    {
        var o = new FirmsOptions();
        var sp = new FirmsFetchPlan("VIIRS_NOAA20_SP", D(7, 1), 5, IsNrt: false);
        var oldNrt = new FirmsFetchPlan("VIIRS_NOAA20_NRT", D(10, 1), 5, IsNrt: true);
        var recentNrt = new FirmsFetchPlan("VIIRS_NOAA20_NRT", D(11, 10), 5, IsNrt: true);

        Assert.Equal(TimeSpan.FromDays(o.ImmutableTtlDays), TimeRangePlanner.CacheTtl(sp, Today, o));
        Assert.Equal(TimeSpan.FromDays(o.ImmutableTtlDays), TimeRangePlanner.CacheTtl(oldNrt, Today, o));
        Assert.Equal(TimeSpan.FromMinutes(o.RecentTtlMinutes), TimeRangePlanner.CacheTtl(recentNrt, Today, o));
    }
}
