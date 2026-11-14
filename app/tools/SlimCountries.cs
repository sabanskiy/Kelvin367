#:package NetTopologySuite@2.6.0
#:package NetTopologySuite.IO.GeoJSON4STJ@4.0.0
#:property PublishAot=false
#:property JsonSerializerIsReflectionEnabledByDefault=true

// Usage: dotnet run SlimCountries.cs -- <in.geojson> <out.json> <toleranceDeg>
// Keeps only iso3 (ADM0_A3) + name, simplifies (topology-preserving) and rounds to 3 decimals.
using System.Globalization;
using System.Text.Json;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Utilities;
using NetTopologySuite.IO.Converters;
using NetTopologySuite.Simplify;

var (src, dst) = (args[0], args[1]);
double tol = double.Parse(args[2], CultureInfo.InvariantCulture);

var factory = new GeometryFactory(new PrecisionModel(), 4326);
var opts = new JsonSerializerOptions();
opts.Converters.Add(new GeoJsonConverterFactory(factory));
FeatureCollection fc;
using (var s = File.OpenRead(src)) fc = JsonSerializer.Deserialize<FeatureCollection>(s, opts)!;

var rounder = new PrecisionModel(1000); // 3 decimals ≈ 100 m
var outFc = new FeatureCollection();
foreach (var f in fc.OrderBy(f => f.Attributes["NAME"]?.ToString()))
{
    var iso = f.Attributes.GetOptionalValue("ADM0_A3")?.ToString();
    var name = f.Attributes.GetOptionalValue("NAME")?.ToString();
    if (string.IsNullOrEmpty(iso) || name is null) continue;

    var g = TopologyPreservingSimplifier.Simplify(f.Geometry, tol);
    g = NetTopologySuite.Precision.GeometryPrecisionReducer.Reduce(g, rounder);
    if (!g.IsValid) g = GeometryFixer.Fix(g);
    if (g.IsEmpty) continue;

    outFc.Add(new Feature(g, new AttributesTable { { "iso3", iso }, { "name", name } }));
}

using (var o = File.Create(dst))
    JsonSerializer.Serialize(o, outFc, opts);

// Sanity check: Simferopol and Sevastopol (Crimea) must fall inside Ukraine, not Russia.
foreach (var (label, lon, lat) in new[] { ("Simferopol", 34.10, 44.95), ("Sevastopol", 33.52, 44.60), ("Kerch", 36.47, 45.36), ("Kyiv", 30.52, 50.45) })
{
    var p = factory.CreatePoint(new Coordinate(lon, lat));
    var hits = outFc.Where(f => f.Geometry.Covers(p)).Select(f => f.Attributes["iso3"]).ToList();
    Console.WriteLine($"{label,-11} → {string.Join(",", hits)}");
}
Console.WriteLine($"{outFc.Count} features, {new FileInfo(dst).Length / 1024} KB");
