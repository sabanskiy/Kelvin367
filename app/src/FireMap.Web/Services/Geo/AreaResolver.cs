using System.Globalization;
using FireMap.Web.Models;
using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Prepared;

namespace FireMap.Web.Services.Geo;

/// <summary>A resolved selection (rectangle or country) ready for filtering and statistics.</summary>
public sealed class QueryArea
{
    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);
    private readonly IPreparedGeometry? _prepared;

    public QueryArea(string kind, string name, string? iso3, Geometry geometry)
    {
        Kind = kind;
        Name = name;
        Iso3 = iso3;
        Geometry = geometry;
        Envelope = geometry.EnvelopeInternal;
        _prepared = geometry.IsRectangle ? null : PreparedGeometryFactory.Prepare(geometry);
        AreaKm2 = GeoMath.AreaKm2(geometry);
    }

    public string Kind { get; }
    public string Name { get; }
    public string? Iso3 { get; }
    public Geometry Geometry { get; }
    public Envelope Envelope { get; }
    public double AreaKm2 { get; }

    public bool Contains(double lon, double lat) =>
        Envelope.Intersects(lon, lat) &&
        (_prepared is null || _prepared.Intersects(Factory.CreatePoint(new Coordinate(lon, lat))));

    public AreaInfo ToInfo() =>
        new(Kind, Name, Iso3, [Envelope.MinX, Envelope.MinY, Envelope.MaxX, Envelope.MaxY], Math.Round(AreaKm2));

    public static Geometry BoxGeometry(double w, double s, double e, double n) => Factory.ToGeometry(new Envelope(w, e, s, n));
}

public sealed class AreaResolver(CountryBoundaryService countries)
{
    public QueryArea Resolve(double[]? bbox, string? country)
    {
        if (!string.IsNullOrWhiteSpace(country))
        {
            var c = countries.Find(country) ?? throw new KeyNotFoundException($"Unknown country code '{country}'.");
            return new QueryArea("country", c.Name, c.Iso3, c.Geometry);
        }
        if (bbox is null) throw new ArgumentException("Provide either 'bbox' (w,s,e,n) or 'country' (ISO3).");
        if (bbox.Length != 4) throw new ArgumentException("bbox must have 4 numbers: west,south,east,north.");

        double w = Math.Clamp(bbox[0], -180, 180), s = Math.Clamp(bbox[1], -90, 90);
        double e = Math.Clamp(bbox[2], -180, 180), n = Math.Clamp(bbox[3], -90, 90);
        if (w >= e || s >= n)
            throw new ArgumentException("bbox must satisfy west < east and south < north (antimeridian-crossing boxes are not supported).");

        var name = string.Create(CultureInfo.InvariantCulture, $"Rectangle {w:0.##},{s:0.##} → {e:0.##},{n:0.##}");
        return new QueryArea("bbox", name, null, QueryArea.BoxGeometry(w, s, e, n));
    }

    public static double[]? ParseBbox(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = raw.Split(',');
        if (parts.Length != 4) throw new ArgumentException("bbox must be 'west,south,east,north'.");
        return parts.Select(p => double.TryParse(p, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
            ? v : throw new ArgumentException($"Invalid bbox number '{p}'.")).ToArray();
    }
}

public static class GeoMath
{
    private const double EarthRadiusKm = 6371.0088;

    /// <summary>Spherical area of a lon/lat (multi)polygon in km² (same method as d3/turf).</summary>
    public static double AreaKm2(Geometry g) => g switch
    {
        Polygon p => Math.Max(0, Math.Abs(RingArea(p.ExteriorRing.Coordinates)) - p.InteriorRings.Sum(r => Math.Abs(RingArea(r.Coordinates)))),
        GeometryCollection gc => gc.Geometries.Sum(AreaKm2),
        _ => 0,
    };

    private static double RingArea(Coordinate[] c)
    {
        if (c.Length < 4) return 0;
        double sum = 0;
        for (int i = 0; i < c.Length - 1; i++)
        {
            double l1 = c[i].X * Math.PI / 180, l2 = c[i + 1].X * Math.PI / 180;
            double p1 = c[i].Y * Math.PI / 180, p2 = c[i + 1].Y * Math.PI / 180;
            sum += (l2 - l1) * (2 + Math.Sin(p1) + Math.Sin(p2));
        }
        return sum * EarthRadiusKm * EarthRadiusKm / 2;
    }
}
