using FireMap.Web.Models;

namespace FireMap.Web.Services.Firms;

/// <summary>A logical FIRMS layer. Each maps to an archive (SP) and a near-real-time (NRT) source id.</summary>
public sealed record FirmsSensor(LayerDescriptor Layer, string SpSourceId, string NrtSourceId)
{
    private const string Group = "NASA FIRMS";

    public static readonly IReadOnlyList<FirmsSensor> All =
    [
        new(new("modis", "MODIS (Terra + Aqua)", Group, "#ff6b35", "MODIS", 1000,
                "MODIS Collection 6.1, 1 km pixels. Long record since 2000.", DefaultVisible: true),
            "MODIS_SP", "MODIS_NRT"),
        new(new("viirs-snpp", "VIIRS S-NPP", Group, "#ffd23f", "VIIRS", 375,
                "VIIRS 375 m on Suomi NPP.", DefaultVisible: false),
            "VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
        new(new("viirs-noaa20", "VIIRS NOAA-20", Group, "#ef476f", "VIIRS", 375,
                "VIIRS 375 m on NOAA-20 (JPSS-1).", DefaultVisible: true),
            "VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
        new(new("viirs-noaa21", "VIIRS NOAA-21", Group, "#b56cff", "VIIRS", 375,
                "VIIRS 375 m on NOAA-21 (JPSS-2).", DefaultVisible: false),
            "VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT"),
    ];
}
