using FireMap.Web.Services.Caching;
using FireMap.Web.Services.Firms;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Hybrid;
using Microsoft.Extensions.Options;

namespace FireMap.Web.Controllers.Api;

[ApiController]
[Route("api")]
public sealed class StatusController(
    FirmsRateGuard guard,
    CacheMetrics metrics,
    FileDistributedCache disk,
    HybridCache cache,
    IOptions<FirmsOptions> firms,
    IWebHostEnvironment env) : ControllerBase
{
    /// <summary>NASA quota usage and cache effectiveness.</summary>
    [HttpGet("status")]
    public object Status()
    {
        var (files, bytes) = disk.Usage();
        return new
        {
            mode = firms.Value.IsLive ? "live" : "sample",
            quota = guard.Snapshot(),
            cache = metrics.Snapshot(),
            disk = new { files, sizeMb = Math.Round(bytes / 1024.0 / 1024.0, 2), path = env.IsDevelopment() ? disk.Root : null },
        };
    }

    /// <summary>
    /// Development only: drop cached FIRMS tiles. <c>DELETE /api/cache?source=VIIRS_NOAA20_NRT&amp;olderThan=2026-11-10</c>
    /// </summary>
    [HttpDelete("cache")]
    public async Task<IActionResult> Clear([FromQuery] string? source, [FromQuery] DateOnly? olderThan)
    {
        if (!env.IsDevelopment()) return NotFound();

        var prefix = source is null ? "firms" : $"firms:{source}";
        int removed = disk.Purge(prefix, olderThan?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
        await cache.RemoveByTagAsync(source is null ? CachedFirmsClient.Tag : CachedFirmsClient.SourceTag(source));
        return Ok(new { removedFiles = removed, memoryTag = source ?? "all" });
    }
}
