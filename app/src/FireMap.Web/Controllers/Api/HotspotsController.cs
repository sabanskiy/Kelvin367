using FireMap.Web.Models;
using FireMap.Web.Services;
using FireMap.Web.Services.Firms;
using FireMap.Web.Services.Geo;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FireMap.Web.Controllers.Api;

[ApiController]
[Route("api/[controller]")]
public sealed class HotspotsController(
    HotspotQueryService query,
    AreaResolver areas,
    IOptions<ApiOptions> api,
    IOptions<FirmsOptions> firms,
    TimeProvider time) : ControllerBase
{
    /// <summary>
    /// GeoJSON points for one layer.
    /// <c>GET /api/hotspots?layer=viirs-noaa20&amp;bbox=22,44,40,53&amp;from=2026-11-01&amp;to=2026-11-12</c>
    /// or <c>&amp;country=UKR</c> instead of bbox.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] string layer, [FromQuery] string? bbox, [FromQuery] string? country,
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(layer)) throw new ArgumentException("'layer' is required.");
        var area = areas.Resolve(AreaResolver.ParseBbox(bbox), country);
        var result = await query.QueryAsync(layer, area, from, to, ct);

        int max = api.Value.MaxPointsPerResponse;
        var items = result.Items;
        bool truncated = items.Count > max;
        if (truncated) items = items.OrderByDescending(h => h.Frp ?? 0).Take(max).ToList(); // keep strongest fires

        // Recent NRT data changes every overpass; older data is effectively immutable.
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        bool recent = to >= today.AddDays(-firms.Value.NrtSettleDays);
        Response.Headers.CacheControl = result.Partial ? "no-store" : $"private, max-age={(recent ? 300 : 86400)}";

        return new JsonResult(new
        {
            type = "FeatureCollection",
            layer = result.Provider.Layer.Id,
            from,
            to,
            totalCount = result.Items.Count,
            truncated,
            partial = result.Partial,
            missing = result.Missing.Take(20),
            features = items.Select(ToFeature),
        })
        { ContentType = "application/geo+json" };
    }

    private static object ToFeature(Hotspot h) => new
    {
        type = "Feature",
        geometry = new { type = "Point", coordinates = new[] { h.Lon, h.Lat } },
        properties = new
        {
            acquired = h.AcquiredUtc,
            satellite = h.Satellite,
            instrument = h.Instrument,
            source = h.SourceId,
            confidence = h.ConfidenceClass,
            confidencePct = h.ConfidencePct,
            frp = h.Frp,
            brightness = h.BrightnessK,
            dayNight = h.DayNight.ToString(),
            scan = h.ScanKm,
            track = h.TrackKm,
            type = h.Type,
        },
    };
}
