using NetTopologySuite.Geometries;
using NetTopologySuite.Geometries.Prepared;

namespace FireMap.Web.Services.Firms;

public readonly record struct TileKey(int X, int Y)
{
    public override string ToString() => $"{X}_{Y}";
}

/// <summary>
/// Fixed lon/lat grid anchored at (-180, -90). Requests are expanded to whole tiles so cache keys repeat
/// no matter how the user pans.
/// </summary>
public static class GridTiling
{
    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);

    public static int Columns(double size) => (int)Math.Round(360 / size);
    public static int Rows(double size) => (int)Math.Round(180 / size);

    public static Envelope TileEnvelope(TileKey t, double size) =>
        new(-180 + t.X * size, -180 + (t.X + 1) * size, -90 + t.Y * size, -90 + (t.Y + 1) * size);

    /// <summary>All tiles touching the envelope (edges that land exactly on a grid line do not pull in the neighbour).</summary>
    public static IReadOnlyList<TileKey> TilesFor(Envelope env, double size)
    {
        int cols = Columns(size), rows = Rows(size);
        int x0 = Clamp((int)Math.Floor((env.MinX + 180) / size), cols);
        int x1 = Clamp((int)Math.Ceiling((env.MaxX + 180) / size) - 1, cols);
        int y0 = Clamp((int)Math.Floor((env.MinY + 90) / size), rows);
        int y1 = Clamp((int)Math.Ceiling((env.MaxY + 90) / size) - 1, rows);
        x1 = Math.Max(x0, x1);
        y1 = Math.Max(y0, y1);

        var list = new List<TileKey>((x1 - x0 + 1) * (y1 - y0 + 1));
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
                list.Add(new TileKey(x, y));
        return list;
    }

    /// <summary>Tiles that actually intersect the geometry — e.g. Russia touches far fewer tiles than its bbox.</summary>
    public static IReadOnlyList<TileKey> TilesFor(Geometry area, double size)
    {
        var candidates = TilesFor(area.EnvelopeInternal, size);
        if (area.IsRectangle) return candidates;

        var prepared = PreparedGeometryFactory.Prepare(area);
        return candidates.Where(t => prepared.Intersects(Factory.ToGeometry(TileEnvelope(t, size)))).ToList();
    }

    private static int Clamp(int v, int count) => Math.Min(Math.Max(v, 0), count - 1);
}
