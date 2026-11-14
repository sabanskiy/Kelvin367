using FireMap.Web.Services.Firms;
using FireMap.Web.Services.Geo;
using NetTopologySuite.Geometries;

namespace FireMap.Tests;

public class GridTilingTests
{
    [Fact]
    public void Nearby_views_map_to_the_same_tiles()
    {
        // NTS Envelope(minX, maxX, minY, maxY)
        var a = GridTiling.TilesFor(new Envelope(22.3, 44.1, 40.7, 52.9), 10);
        var b = GridTiling.TilesFor(new Envelope(21.1, 43.0, 41.0, 53.5), 10);
        Assert.Equal(a, b);
    }

    [Fact]
    public void Edge_on_grid_line_does_not_pull_in_neighbour()
    {
        var tiles = GridTiling.TilesFor(new Envelope(20, 40, 30, 50), 10); // lon 20..40, lat 30..50
        Assert.Equal(4, tiles.Count); // 2 × 2
    }

    [Fact]
    public void World_has_648_tiles_of_10_degrees()
    {
        Assert.Equal(648, GridTiling.TilesFor(new Envelope(-180, 180, -90, 90), 10).Count);
    }

    [Fact]
    public void Tile_envelope_round_trips()
    {
        var t = new TileKey(20, 13);
        var env = GridTiling.TileEnvelope(t, 10);
        Assert.Equal(new Envelope(20, 30, 40, 50), env);
        Assert.Equal([t], GridTiling.TilesFor(env, 10));
    }

    [Fact]
    public void Polygon_only_uses_tiles_it_intersects()
    {
        // L-shaped polygon: its bbox covers 4 tiles but it only touches 3.
        var f = new GeometryFactory();
        var poly = f.CreatePolygon([
            new(1, 1), new(19, 1), new(19, 9), new(9, 9), new(9, 19), new(1, 19), new(1, 1)]);
        Assert.Equal(4, GridTiling.TilesFor(poly.EnvelopeInternal, 10).Count);
        Assert.Equal(3, GridTiling.TilesFor(poly, 10).Count);
    }

    [Fact]
    public void Bbox_area_is_close_to_reference()
    {
        // 1°×1° at the equator ≈ 12,364 km².
        var area = GeoMath.AreaKm2(QueryArea.BoxGeometry(0, 0, 1, 1));
        Assert.InRange(area, 12_300, 12_400);
    }
}
