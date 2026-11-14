using FireMap.Web.Infrastructure;
using FireMap.Web.Services;
using FireMap.Web.Services.Caching;
using FireMap.Web.Services.Firms;
using FireMap.Web.Services.Geo;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// API controllers only: the UI is the React SPA in ClientApp/, built into wwwroot/.
builder.Services.AddControllers(o => o.Filters.Add<ApiExceptionFilter>());
builder.Services.AddProblemDetails();
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/geo+json"]);
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);

// ---- Options ---------------------------------------------------------------------------------
builder.Services.Configure<FirmsOptions>(builder.Configuration.GetSection(FirmsOptions.Section));
builder.Services.Configure<ApiOptions>(builder.Configuration.GetSection(ApiOptions.Section));
var firmsOptions = builder.Configuration.GetSection(FirmsOptions.Section).Get<FirmsOptions>() ?? new FirmsOptions();
builder.Services.AddSingleton(TimeProvider.System);

// ---- Caching: HybridCache = L1 memory + L2 disk (FileDistributedCache) -----------------------
builder.Services.AddSingleton<CacheMetrics>();
builder.Services.AddSingleton(sp => new FileDistributedCache(
    Path.Combine(builder.Environment.ContentRootPath, firmsOptions.CacheDirectory),
    sp.GetRequiredService<CacheMetrics>(),
    sp.GetRequiredService<TimeProvider>(),
    sp.GetRequiredService<ILogger<FileDistributedCache>>()));
builder.Services.AddSingleton<IDistributedCache>(sp => sp.GetRequiredService<FileDistributedCache>());
builder.Services.AddHybridCache(o =>
{
    o.MaximumPayloadBytes = 64 * 1024 * 1024; // a busy 10° tile × 5 days of VIIRS can exceed the 1 MB default
    o.DefaultEntryOptions = new() { Expiration = TimeSpan.FromMinutes(20), LocalCacheExpiration = TimeSpan.FromMinutes(20) };
});

// ---- NASA FIRMS -------------------------------------------------------------------------------
builder.Services.AddHttpClient(FirmsClient.HttpClientName, (sp, c) =>
{
    c.BaseAddress = new Uri(sp.GetRequiredService<IOptions<FirmsOptions>>().Value.BaseUrl.TrimEnd('/') + "/");
    c.Timeout = TimeSpan.FromSeconds(90);
});
builder.Services.AddSingleton<FirmsRateGuard>();
builder.Services.AddSingleton<FirmsClient>();
builder.Services.AddSingleton<CachedFirmsClient>();
builder.Services.AddSingleton<FirmsAvailabilityService>();
builder.Services.AddHostedService<FirmsStatusPoller>();

// ---- Layers: one IHotspotProvider per map layer ----------------------------------------------
foreach (var sensor in FirmsSensor.All)
{
    if (firmsOptions.IsLive)
        builder.Services.AddSingleton<IHotspotProvider>(sp => ActivatorUtilities.CreateInstance<FirmsHotspotProvider>(sp, sensor));
    else
        builder.Services.AddSingleton<IHotspotProvider>(sp => ActivatorUtilities.CreateInstance<SampleHotspotProvider>(sp, sensor));
}
// Harmonized data from the team goes here, e.g.:
// builder.Services.AddSingleton<IHotspotProvider, HarmonizedHotspotProvider>();

builder.Services.AddSingleton<HotspotProviderRegistry>();
builder.Services.AddSingleton<CountryBoundaryService>();
builder.Services.AddSingleton<AreaResolver>();
builder.Services.AddSingleton<HotspotQueryService>();
builder.Services.AddSingleton<StatsService>();

var app = builder.Build();

app.Logger.LogInformation(firmsOptions.IsLive
    ? "FIRMS live mode (MAP_KEY configured)."
    : "FIRMS MAP_KEY not set — serving sample data. Set it with: dotnet user-secrets set Firms:MapKey <key>");

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();
    app.UseHsts();
}

app.UseResponseCompression();
app.UseHttpsRedirection();
// Files written into wwwroot after the build (e.g. `npm run build` while the app runs) are not in the
// static-assets manifest; plain static files cover them. Grid binaries (*.bin.gz) are served as-is and
// unpacked by the browser, so they must not get a Content-Encoding header.
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();

app.MapStaticAssets();
app.MapControllers();
app.Map("/api/{**rest}", () => Results.NotFound()); // unknown API paths must not fall through to the SPA
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
