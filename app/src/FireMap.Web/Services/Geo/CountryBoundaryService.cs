using System.Text.Json;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Utilities;
using NetTopologySuite.IO.Converters;

namespace FireMap.Web.Services.Geo;

public sealed record Country(string Iso3, string Name, Geometry Geometry);

/// <summary>
/// Country polygons from wwwroot/data/countries.json: Natural Earth 1:10m admin-0, <b>Ukraine point of view</b>
/// (Crimea and all occupied territories are part of Ukraine), simplified to ~2 km by tools/SlimCountries.cs.
/// The same file is drawn by the frontend, so what the user clicks is exactly what is filtered here.
/// </summary>
public sealed class CountryBoundaryService
{
    private readonly Lazy<Dictionary<string, Country>> _countries;

    public CountryBoundaryService(IWebHostEnvironment env, ILogger<CountryBoundaryService> log)
    {
        var path = Path.Combine(env.WebRootPath, "data", "countries.json");
        _countries = new Lazy<Dictionary<string, Country>>(() => Load(path, log));
    }

    public Country? Find(string iso3) => _countries.Value.GetValueOrDefault(iso3.Trim().ToUpperInvariant());

    public IEnumerable<Country> All => _countries.Value.Values;

    private static Dictionary<string, Country> Load(string path, ILogger log)
    {
        var json = new JsonSerializerOptions();
        json.Converters.Add(new GeoJsonConverterFactory(new GeometryFactory(new PrecisionModel(), 4326)));
        using var stream = File.OpenRead(path);
        var fc = JsonSerializer.Deserialize<FeatureCollection>(stream, json) ?? [];

        var map = new Dictionary<string, Country>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in fc)
        {
            var iso = f.Attributes["iso3"]?.ToString();
            var name = f.Attributes["name"]?.ToString() ?? iso;
            if (string.IsNullOrEmpty(iso) || iso == "-99" || name is null) continue;
            // Rounded coordinates can create tiny self-intersections; fix once at load.
            var geom = f.Geometry.IsValid ? f.Geometry : GeometryFixer.Fix(f.Geometry);
            map[iso] = new Country(iso, name, geom);
        }
        log.LogInformation("Loaded {Count} country boundaries", map.Count);
        return map;
    }
}
