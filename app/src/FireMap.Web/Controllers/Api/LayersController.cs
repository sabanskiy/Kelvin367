using FireMap.Web.Services;
using FireMap.Web.Services.Firms;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FireMap.Web.Controllers.Api;

[ApiController]
[Route("api")]
public sealed class LayersController(
    HotspotProviderRegistry registry,
    IOptions<FirmsOptions> firms,
    IOptions<ApiOptions> api,
    TimeProvider time) : ControllerBase
{
    /// <summary>Settings the frontend needs (tile grid for request snapping, limits, data mode).</summary>
    [HttpGet("config")]
    public object Config() => new
    {
        mode = firms.Value.IsLive ? "live" : "sample",
        today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime),
        tileSizeDeg = firms.Value.TileSizeDeg,
        maxRangeDays = api.Value.MaxRangeDays,
        mapMaxTiles = api.Value.MapMaxTiles,
        requestGridDeg = api.Value.RequestGridDeg,
        transactionsPerDay = firms.Value.TransactionsPerDay,
        maxPointsPerResponse = api.Value.MaxPointsPerResponse,
    };

    /// <summary>All layers (FIRMS sensors + any registered provider such as harmonized data) with date coverage.</summary>
    [HttpGet("layers")]
    public async Task<object> Layers(CancellationToken ct)
    {
        var list = await Task.WhenAll(registry.All.Select(async p =>
        {
            var cov = await p.GetCoverageAsync(ct);
            var l = p.Layer;
            return new
            {
                l.Id, l.Name, l.Group, l.Color, l.Instrument, l.ResolutionM, l.Description, l.DefaultVisible,
                minDate = cov?.Min,
                maxDate = cov?.Max,
            };
        }));
        return list;
    }
}
