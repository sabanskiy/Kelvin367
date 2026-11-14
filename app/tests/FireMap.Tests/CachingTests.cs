using FireMap.Web.Services.Caching;
using FireMap.Web.Services.Firms;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FireMap.Tests;

public sealed class CachingTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "firemap-tests-" + Guid.NewGuid().ToString("N"));
    private readonly ManualTime _time = new(new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero));

    private FileDistributedCache NewCache() =>
        new(_dir, new CacheMetrics(), _time, NullLogger<FileDistributedCache>.Instance);

    [Fact]
    public async Task File_cache_round_trips_and_survives_new_instance()
    {
        var payload = "latitude,longitude\n1,2\n"u8.ToArray();
        await NewCache().SetAsync("firms:MODIS_NRT:2026-11-10_5d:20_13", payload,
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) });

        // A fresh instance = app restart.
        var read = await NewCache().GetAsync("firms:MODIS_NRT:2026-11-10_5d:20_13");
        Assert.Equal(payload, read);
        Assert.True(File.Exists(Path.Combine(_dir, "firms", "MODIS_NRT", "2026-11-10_5d", "20_13.gz")));
    }

    [Fact]
    public async Task File_cache_honours_expiry()
    {
        var cache = NewCache();
        await cache.SetAsync("k:a", [1, 2, 3], new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(20) });
        _time.Advance(TimeSpan.FromMinutes(21));
        Assert.Null(await cache.GetAsync("k:a"));
    }

    [Fact]
    public async Task Purge_by_prefix()
    {
        var cache = NewCache();
        var opts = new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) };
        await cache.SetAsync("firms:A:1:t", [1], opts);
        await cache.SetAsync("firms:B:1:t", [1], opts);

        Assert.Equal(1, cache.Purge("firms:A", null));
        Assert.Null(await cache.GetAsync("firms:A:1:t"));
        Assert.NotNull(await cache.GetAsync("firms:B:1:t"));
    }

    [Fact]
    public void Rate_guard_blocks_at_soft_limit_and_recovers_after_window()
    {
        var guard = new FirmsRateGuard(Options.Create(new FirmsOptions { SoftLimit = 2 }), _time);
        Assert.True(guard.TryAcquire());
        Assert.True(guard.TryAcquire());
        Assert.False(guard.TryAcquire());

        _time.Advance(TimeSpan.FromMinutes(11));
        Assert.True(guard.TryAcquire());
    }

    [Fact]
    public void Rate_guard_counts_weighted_cost()
    {
        // FIRMS charges 2 transactions per requested day.
        var guard = new FirmsRateGuard(Options.Create(new FirmsOptions { SoftLimit = 20 }), _time);
        Assert.True(guard.TryAcquire(10));  // 5-day request
        Assert.True(guard.TryAcquire(10));
        Assert.False(guard.TryAcquire(2));
        Assert.Equal(20, guard.Snapshot().TransactionsUsed);
    }

    [Fact]
    public void Rate_guard_respects_remote_count_and_trip()
    {
        var guard = new FirmsRateGuard(Options.Create(new FirmsOptions { SoftLimit = 100 }), _time);
        guard.UpdateRemote(150, 5000);
        Assert.False(guard.TryAcquire());

        var guard2 = new FirmsRateGuard(Options.Create(new FirmsOptions()), _time);
        guard2.Trip(TimeSpan.FromMinutes(1));
        Assert.False(guard2.TryAcquire());
        _time.Advance(TimeSpan.FromMinutes(2));
        Assert.True(guard2.TryAcquire());
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private sealed class ManualTime(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now += by;
    }
}
