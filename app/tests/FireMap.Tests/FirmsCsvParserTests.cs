using FireMap.Web.Models;
using FireMap.Web.Services.Firms;

namespace FireMap.Tests;

public class FirmsCsvParserTests
{
    // Rows copied from real FIRMS responses (2026-11).
    private const string Viirs = """
        latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
        52.55987,39.57394,351.14,0.35,0.57,2026-11-08,39,N20,VIIRS,n,2.0NRT,260.93,6.81,N
        50.92851,21.67314,306.77,0.5,0.49,2026-11-08,1224,N21,VIIRS,h,2.0NRT,273.39,1.5,D
        """;

    private const string Modis = """
        latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
        35.72335,44.04292,317.73,1.01,1.01,2026-11-08,603,Terra,MODIS,78,6.1NRT,282.83,18.2,D
        48.6056,21.1866,304.4,1,1,2026-07-20,252,Aqua,MODIS,25,61.03,287.6,8,N
        """;

    private const string ViirsSp = """
        latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type
        48.51235,27.36977,304.08,0.38,0.36,2026-07-20,20,N20,VIIRS,n,2,288.11,0.46,N,0
        """;

    [Fact]
    public void Parses_viirs_nrt()
    {
        var list = FirmsCsvParser.Parse(Viirs, "viirs", "VIIRS_NOAA20_NRT");

        Assert.Equal(2, list.Count);
        var a = list[0];
        Assert.Equal(52.55987, a.Lat);
        Assert.Equal(39.57394, a.Lon);
        Assert.Equal(new DateTime(2026, 11, 8, 0, 39, 0, DateTimeKind.Utc), a.AcquiredUtc);
        Assert.Equal("NOAA-20", a.Satellite);
        Assert.Equal(ConfidenceClasses.Nominal, a.ConfidenceClass);
        Assert.Null(a.ConfidencePct);
        Assert.Equal(6.81, a.Frp);
        Assert.Equal(351.14, a.BrightnessK);
        Assert.Equal('N', a.DayNight);

        Assert.Equal(new DateTime(2026, 11, 8, 12, 24, 0, DateTimeKind.Utc), list[1].AcquiredUtc);
        Assert.Equal(ConfidenceClasses.High, list[1].ConfidenceClass);
        Assert.Equal("NOAA-21", list[1].Satellite);
    }

    [Fact]
    public void Parses_modis_and_maps_numeric_confidence()
    {
        var list = FirmsCsvParser.Parse(Modis, "modis", "MODIS_NRT");

        Assert.Equal(78, list[0].ConfidencePct);
        Assert.Equal(ConfidenceClasses.Nominal, list[0].ConfidenceClass);
        Assert.Equal(317.73, list[0].BrightnessK);
        Assert.Equal(new DateTime(2026, 11, 8, 6, 3, 0, DateTimeKind.Utc), list[0].AcquiredUtc);
        Assert.Equal(ConfidenceClasses.Low, list[1].ConfidenceClass);
    }

    [Fact]
    public void Parses_sp_type_column()
    {
        var h = Assert.Single(FirmsCsvParser.Parse(ViirsSp, "viirs", "VIIRS_NOAA20_SP"));
        Assert.Equal(0, h.Type);
    }

    [Fact]
    public void Header_only_is_empty_and_garbage_throws()
    {
        Assert.Empty(FirmsCsvParser.Parse("latitude,longitude,acq_date\n", "x", "y"));
        Assert.Throws<FormatException>(() => FirmsCsvParser.Parse("Invalid MAP_KEY.", "x", "y"));
    }

    [Theory]
    [InlineData("29", ConfidenceClasses.Low)]
    [InlineData("30", ConfidenceClasses.Nominal)]
    [InlineData("79", ConfidenceClasses.Nominal)]
    [InlineData("80", ConfidenceClasses.High)]
    [InlineData("l", ConfidenceClasses.Low)]
    public void Confidence_thresholds(string raw, string expected) =>
        Assert.Equal(expected, FirmsCsvParser.ParseConfidence(raw).Class);
}
