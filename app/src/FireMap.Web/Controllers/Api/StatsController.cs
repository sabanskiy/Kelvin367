using FireMap.Web.Models;
using FireMap.Web.Services;
using Microsoft.AspNetCore.Mvc;

namespace FireMap.Web.Controllers.Api;

[ApiController]
[Route("api/[controller]")]
public sealed class StatsController(StatsService stats) : ControllerBase
{
    /// <summary>
    /// Statistics for a rectangle or a country:
    /// <c>POST /api/stats { "layers": ["modis","viirs-noaa20"], "country": "UKR", "from": "2026-11-01", "to": "2026-11-12" }</c>
    /// </summary>
    [HttpPost]
    public Task<StatsResult> Post([FromBody] StatsRequest request, CancellationToken ct) => stats.ComputeAsync(request, ct);
}
