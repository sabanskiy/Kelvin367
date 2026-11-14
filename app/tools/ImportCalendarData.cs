#:package NetTopologySuite@2.6.0
#:package NetTopologySuite.IO.GeoJSON4STJ@4.0.0
#:property PublishAot=false
#:property JsonSerializerIsReflectionEnabledByDefault=true

// Imports the spacechallenge calendar data (app/data) into the web app (wwwroot/data/calendar).
//
// Usage: dotnet run tools/ImportCalendarData.cs -- <spacechallenge app/data> <out dir> [--countries <countries.json>] [--require-crimea]
//
// The spacechallenge pipeline uses default Natural Earth boundaries, in which Crimea is not part of Ukraine.
// Until that data is rebuilt with ne_10m_admin_0_countries_ukr, Ukraine is left out of the History tab:
//   * ukraine.json is not copied and "ukraine" is removed from index.json;
//   * every grid cell whose 0.5° square touches Ukraine (Ukraine POV polygon from countries.json) is removed
//     from the grids, and the Uint16 binary (layout (series*C + cell)*W) is re-sliced.
// With --require-crimea, Ukraine is kept, and the import fails unless the grid cells of Simferopol,
// Sevastopol and Kerch are present: use it once the data has been rebuilt.
using System.Globalization;
using System.IO.Compression;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using NetTopologySuite.Features;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO.Converters;

var positional = new List<string>();
string? countriesPath = null;
bool requireCrimea = false;
for (int i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--require-crimea": requireCrimea = true; break;
        case "--countries": countriesPath = args[++i]; break;
        default: positional.Add(args[i]); break;
    }
}
if (positional.Count != 2)
{
    Console.Error.WriteLine("Usage: dotnet run tools/ImportCalendarData.cs -- <src app/data> <out dir> [--countries <countries.json>] [--require-crimea]");
    return 2;
}
var (src, dst) = (positional[0], positional[1]);
countriesPath ??= Path.Combine(dst, "..", "countries.json");

const string ExcludedArea = "ukraine";
const string ExcludedIso3 = "UKR";
const double TouchBufferDeg = 0.02; // countries.json is simplified at 0.02°: count near-misses as touching
var crimea = new[] { ("Simferopol", 34.10, 44.95), ("Sevastopol", 33.52, 44.60), ("Kerch", 36.47, 45.36) };

var jsonOut = new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
var jsonOutIndented = new JsonSerializerOptions(jsonOut) { WriteIndented = true };

// ---- boundaries ------------------------------------------------------------------------------------
var factory = new GeometryFactory(new PrecisionModel(), 4326);
var geoOpts = new JsonSerializerOptions();
geoOpts.Converters.Add(new GeoJsonConverterFactory(factory));
FeatureCollection countries;
using (var s = File.OpenRead(countriesPath)) countries = JsonSerializer.Deserialize<FeatureCollection>(s, geoOpts)!;
var ukr = countries.FirstOrDefault(f => f.Attributes["iso3"]?.ToString() == ExcludedIso3)?.Geometry
    ?? throw new InvalidOperationException($"{ExcludedIso3} not found in {countriesPath}");
// The boundary file must itself treat Crimea as Ukraine, or the exclusion would leave Crimean cells behind.
foreach (var (label, lon, lat) in crimea)
    if (!ukr.Covers(factory.CreatePoint(new Coordinate(lon, lat))))
        throw new InvalidOperationException($"{countriesPath}: {label} is not inside {ExcludedIso3}. Use the Ukraine POV boundaries.");
var ukrTouch = ukr.Buffer(TouchBufferDeg);
var others = countries.Where(f => f.Attributes["iso3"]?.ToString() != ExcludedIso3).ToList();

Directory.CreateDirectory(dst);
int failures = 0;
void Fail(string msg) { Console.Error.WriteLine($"FAIL: {msg}"); failures++; }

// ---- areas -----------------------------------------------------------------------------------------
var index = JsonNode.Parse(File.ReadAllText(Path.Combine(src, "index.json")))!.AsObject();
var aois = index["aois"]!.AsArray();
var areaIds = aois.Select(a => a!["id"]!.GetValue<string>()).ToList();
if (!requireCrimea)
{
    foreach (var a in aois.Where(a => a!["id"]!.GetValue<string>() == ExcludedArea).ToList()) aois.Remove(a);
    index["excluded"] = new JsonArray(new JsonObject
    {
        ["id"] = ExcludedArea,
        ["reason"] = "Source data uses boundaries in which Crimea is not part of Ukraine; excluded until rebuilt with the Ukraine POV boundaries.",
    });
}
else if (!areaIds.Contains(ExcludedArea))
{
    Fail($"--require-crimea: index.json has no '{ExcludedArea}' area");
}
File.WriteAllText(Path.Combine(dst, "index.json"), index.ToJsonString(jsonOutIndented));

foreach (var id in areaIds)
{
    if (id == ExcludedArea && !requireCrimea) continue;
    File.Copy(Path.Combine(src, $"{id}.json"), Path.Combine(dst, $"{id}.json"), overwrite: true);
}
// A previous import may have left an excluded area behind.
if (!requireCrimea) File.Delete(Path.Combine(dst, $"{ExcludedArea}.json"));
Console.WriteLine($"areas: {string.Join(", ", aois.Select(a => a!["id"]))}{(requireCrimea ? "" : $"  (excluded: {ExcludedArea})")}");

// ---- grids -----------------------------------------------------------------------------------------
var gridsPath = Path.Combine(src, "grids.json");
var gridsIndex = File.Exists(gridsPath) ? JsonNode.Parse(File.ReadAllText(gridsPath))!.AsObject() : new JsonObject { ["grids"] = new JsonArray() };
foreach (var gi in gridsIndex["grids"]!.AsArray())
{
    var gid = gi!["id"]!.GetValue<string>();
    var meta = JsonNode.Parse(File.ReadAllText(Path.Combine(src, $"{gid}.meta.json")))!.AsObject();
    double deg = meta["deg"]!.GetValue<double>();
    var cells = meta["cells"]!.AsArray().Select(c => (iy: c![0]!.GetValue<int>(), ix: c[1]!.GetValue<int>())).ToList();
    int S = meta["series"]!.AsArray().Count, C = cells.Count, W = meta["weeks"]!.AsArray().Count;

    byte[] bin;
    using (var gz = new GZipStream(File.OpenRead(Path.Combine(src, $"{gid}.bin.gz")), CompressionMode.Decompress))
    using (var ms = new MemoryStream()) { gz.CopyTo(ms); bin = ms.ToArray(); }
    if (bin.Length != S * C * W * 2) { Fail($"{gid}: binary is {bin.Length} bytes, expected S*C*W*2 = {S * C * W * 2}"); continue; }

    Polygon Square(int iy, int ix) => (Polygon)factory.ToGeometry(new Envelope(ix * deg, (ix + 1) * deg, iy * deg, (iy + 1) * deg));
    var touching = Enumerable.Range(0, C).Where(c => ukrTouch.Intersects(Square(cells[c].iy, cells[c].ix))).ToList();

    if (requireCrimea)
    {
        // Ukraine stays: the cells of the Crimean cities must be there.
        if (touching.Count > 0)
            foreach (var (label, lon, lat) in crimea)
            {
                var key = ((int)Math.Floor(lat / deg), (int)Math.Floor(lon / deg));
                if (!cells.Contains(key)) Fail($"{gid}: no cell for {label} ({lat}, {lon}) although the grid covers Ukraine");
            }
        File.Copy(Path.Combine(src, $"{gid}.meta.json"), Path.Combine(dst, $"{gid}.meta.json"), overwrite: true);
        File.Copy(Path.Combine(src, $"{gid}.bin.gz"), Path.Combine(dst, $"{gid}.bin.gz"), overwrite: true);
        Console.WriteLine($"{gid}: {C} cells, copied ({touching.Count} touch {ExcludedIso3})");
        continue;
    }

    if (touching.Count == 0)
    {
        File.Copy(Path.Combine(src, $"{gid}.meta.json"), Path.Combine(dst, $"{gid}.meta.json"), overwrite: true);
        File.Copy(Path.Combine(src, $"{gid}.bin.gz"), Path.Combine(dst, $"{gid}.bin.gz"), overwrite: true);
        Console.WriteLine($"{gid}: {C} cells, copied unchanged");
        continue;
    }

    // Report the other countries the dropped squares touch: border cells are clipped to the grid's
    // countries, so these must all be Ukraine's neighbours (outside the grid), never a grid country.
    var drop = touching.ToHashSet();
    var neighbours = others
        .Where(f => touching.Any(c => f.Geometry.Intersects(Square(cells[c].iy, cells[c].ix))))
        .Select(f => f.Attributes["iso3"]!.ToString()!).Order().ToList();

    var keep = Enumerable.Range(0, C).Where(c => !drop.Contains(c)).ToList();
    int C2 = keep.Count;
    var outBin = new byte[S * C2 * W * 2];
    for (int s = 0; s < S; s++)
        for (int k = 0; k < C2; k++)
            Buffer.BlockCopy(bin, (s * C + keep[k]) * W * 2, outBin, (s * C2 + k) * W * 2, W * 2);

    var total = meta["total"]!.AsArray();
    long droppedDetections = touching.Sum(c => total[c]!.GetValue<long>());
    meta["cells"] = new JsonArray(keep.Select(c => (JsonNode)new JsonArray(cells[c].iy, cells[c].ix)).ToArray());
    meta["total"] = new JsonArray(keep.Select(c => (JsonNode)JsonValue.Create(total[c]!.GetValue<long>())).ToArray());
    meta["name"] = RemoveUkraine(meta["name"]!.GetValue<string>());
    meta["geometry_note"] = RemoveUkraine(meta["geometry_note"]!.GetValue<string>())
        + $" Cells touching Ukraine are removed in this copy: the source boundaries do not treat Crimea as part of Ukraine.";
    gi["cells"] = C2;

    File.WriteAllText(Path.Combine(dst, $"{gid}.meta.json"), meta.ToJsonString(jsonOut));
    using (var fs = File.Create(Path.Combine(dst, $"{gid}.bin.gz")))
    using (var gz = new GZipStream(fs, CompressionLevel.SmallestSize))
        gz.Write(outBin);

    // Verify what was written.
    foreach (var c in keep)
    {
        var (iy, ix) = cells[c];
        if (ukr.Covers(factory.CreatePoint(new Coordinate((ix + 0.5) * deg, (iy + 0.5) * deg))))
            Fail($"{gid}: kept cell [{iy},{ix}] has its centre in {ExcludedIso3}");
    }
    Console.WriteLine($"{gid}: {C} → {C2} cells (removed {touching.Count} touching {ExcludedIso3}, {droppedDetections:N0} detections; " +
                      $"they also touch {string.Join(",", neighbours)}), binary {outBin.Length:N0} bytes = S*C*W*2");
}
File.WriteAllText(Path.Combine(dst, "grids.json"), gridsIndex.ToJsonString(jsonOutIndented));

// ---- final checks ----------------------------------------------------------------------------------
var written = JsonNode.Parse(File.ReadAllText(Path.Combine(dst, "index.json")))!["aois"]!.AsArray().Select(a => a!["id"]!.GetValue<string>()).ToList();
if (!requireCrimea && (written.Contains(ExcludedArea) || File.Exists(Path.Combine(dst, $"{ExcludedArea}.json"))))
    Fail($"{ExcludedArea} is still in the output");
foreach (var id in written)
    if (!File.Exists(Path.Combine(dst, $"{id}.json"))) Fail($"{id}.json is listed in index.json but missing");

long bytes = Directory.EnumerateFiles(dst).Sum(f => new FileInfo(f).Length);
Console.WriteLine($"{dst}: {Directory.EnumerateFiles(dst).Count()} files, {bytes / 1024.0 / 1024.0:F1} MB");
return failures == 0 ? 0 : 1;

static string RemoveUkraine(string s) => s
    .Replace("Ukraine, ", "", StringComparison.Ordinal)
    .Replace(" of Ukraine,", " of", StringComparison.Ordinal)
    .Replace(", Ukraine", "", StringComparison.Ordinal);
