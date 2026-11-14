using FireMap.Web.Models;
using FireMap.Web.Services.Caching;
using Microsoft.Extensions.Caching.Hybrid;
using Microsoft.Extensions.Options;

namespace FireMap.Web.Services.Firms;

/// <summary>
/// Fetches one (source, time chunk, grid tile) through HybridCache: L1 memory → L2 disk → FIRMS.
/// HybridCache also coalesces concurrent identical requests into a single upstream call.
/// </summary>
public sealed class CachedFirmsClient(
    HybridCache cache,
    FirmsClient client,
    FirmsRateGuard guard,
    CacheMetrics metrics,
    IOptions<FirmsOptions> options,
    TimeProvider time,
    ILogger<CachedFirmsClient> log)
{
    private static readonly TimeSpan MaxLocalTtl = TimeSpan.FromMinutes(30);

    public const string Tag = "firms";
    public static string SourceTag(string sourceId) => $"firms:{sourceId}";

    /// <summary>Returns the tile's CSV, or null when it is not cached and the quota guard forbids fetching it.</summary>
    public async Task<string?> GetTileCsvAsync(FirmsFetchPlan plan, TileKey tile, CancellationToken ct)
    {
        var o = options.Value;
        var ttl = TimeRangePlanner.CacheTtl(plan, Today, o);
        var entry = new HybridCacheEntryOptions
        {
            Expiration = ttl,
            LocalCacheExpiration = ttl < MaxLocalTtl ? ttl : MaxLocalTtl,
        };

        metrics.Lookup();
        try
        {
            return await cache.GetOrCreateAsync(
                plan.CacheKey(tile, o.TileSizeDeg),
                (Self: this, Plan: plan, Tile: tile),
                static (s, token) => s.Self.FetchAsync(s.Plan, s.Tile, token),
                entry,
                [Tag, SourceTag(plan.SourceId)],
                ct);
        }
        catch (FirmsQuotaException)
        {
            metrics.QuotaRejection();
            return null;
        }
    }

    private async ValueTask<string> FetchAsync(FirmsFetchPlan plan, TileKey tile, CancellationToken ct)
    {
        // Throwing (instead of returning empty) guarantees nothing is cached for a skipped tile.
        var o = options.Value;
        if (!guard.TryAcquire(plan.Days * o.TransactionsPerDay))
        {
            log.LogWarning("Quota guard: skipping FIRMS call for {Key}", plan.CacheKey(tile, o.TileSizeDeg));
            throw new FirmsQuotaException("FIRMS transaction budget reached.");
        }
        var env = GridTiling.TileEnvelope(tile, o.TileSizeDeg);
        return await client.GetAreaCsvAsync(plan.SourceId, env, plan.Start, plan.Days, ct);
    }

    private DateOnly Today => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
}

/// <summary>Per-source date coverage from <c>/api/data_availability</c>, cached for hours.</summary>
public sealed class FirmsAvailabilityService(
    HybridCache cache, FirmsClient client, IOptions<FirmsOptions> options, ILogger<FirmsAvailabilityService> log)
{
    public async Task<IReadOnlyDictionary<string, DateRange>> GetAsync(CancellationToken ct)
    {
        try
        {
            var csv = await cache.GetOrCreateAsync(
                "firms:meta:availability",
                client,
                static async (c, token) => await c.GetAvailabilityCsvAsync(token),
                new HybridCacheEntryOptions { Expiration = TimeSpan.FromHours(options.Value.AvailabilityTtlHours) },
                [CachedFirmsClient.Tag],
                ct);
            return Parse(csv);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning("FIRMS availability unavailable, using fallback: {Error}", ex.Message);
            return new Dictionary<string, DateRange>();
        }
    }

    public static Dictionary<string, DateRange> Parse(string csv)
    {
        var map = new Dictionary<string, DateRange>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Skip(1))
        {
            var f = line.Split(',');
            if (f.Length >= 3 && DateOnly.TryParse(f[1], out var min) && DateOnly.TryParse(f[2], out var max))
                map[f[0]] = new DateRange(min, max);
        }
        return map;
    }
}

/// <summary>Keeps <see cref="FirmsRateGuard"/> in sync with FIRMS' own transaction counter.</summary>
public sealed class FirmsStatusPoller(
    FirmsClient client, FirmsRateGuard guard, IOptions<FirmsOptions> options, ILogger<FirmsStatusPoller> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.IsLive) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(30, options.Value.StatusPollSeconds)));
        do
        {
            try
            {
                var s = await client.GetMapKeyStatusAsync(stoppingToken);
                guard.UpdateRemote(s.CurrentTransactions, s.TransactionLimit);
                log.LogDebug("FIRMS quota {Used}/{Limit}", s.CurrentTransactions, s.TransactionLimit);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning("mapkey_status poll failed: {Error}", ex.Message);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
