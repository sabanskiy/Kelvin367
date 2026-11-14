using System.Globalization;
using FireMap.Web.Models;

namespace FireMap.Web.Services.Firms;

/// <summary>
/// Parses FIRMS CSV (MODIS or VIIRS, NRT or SP) into <see cref="Hotspot"/>s.
/// FIRMS CSV has no quoted fields, so a plain split is enough and much faster than a general CSV reader.
/// </summary>
public static class FirmsCsvParser
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static bool LooksLikeFirmsCsv(string content) =>
        content.StartsWith("latitude,", StringComparison.Ordinal) || content.Length == 0;

    public static List<Hotspot> Parse(string csv, string layerId, string sourceId)
    {
        var result = new List<Hotspot>();
        if (string.IsNullOrWhiteSpace(csv)) return result;

        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (lines.Length == 0) return result;
        if (!lines[0].StartsWith("latitude", StringComparison.Ordinal))
            throw new FormatException($"Not a FIRMS CSV: '{Truncate(lines[0])}'");

        var h = lines[0].Split(',');
        int Col(params string[] names)
        {
            foreach (var n in names)
            {
                int i = Array.IndexOf(h, n);
                if (i >= 0) return i;
            }
            return -1;
        }

        int iLat = Col("latitude"), iLon = Col("longitude");
        int iBright = Col("bright_ti4", "brightness");
        int iScan = Col("scan"), iTrack = Col("track");
        int iDate = Col("acq_date"), iTime = Col("acq_time");
        int iSat = Col("satellite"), iInst = Col("instrument");
        int iConf = Col("confidence"), iFrp = Col("frp"), iDn = Col("daynight"), iType = Col("type");
        if (iLat < 0 || iLon < 0 || iDate < 0)
            throw new FormatException("FIRMS CSV is missing latitude/longitude/acq_date.");

        for (int li = 1; li < lines.Length; li++)
        {
            var f = lines[li].Split(',');
            if (f.Length < h.Length) continue;

            if (!double.TryParse(f[iLat], NumberStyles.Float, Inv, out var lat) ||
                !double.TryParse(f[iLon], NumberStyles.Float, Inv, out var lon) ||
                !DateOnly.TryParseExact(f[iDate], "yyyy-MM-dd", Inv, DateTimeStyles.None, out var date))
                continue;

            // acq_time is HHMM without leading zeros ("13" = 00:13 UTC).
            int hhmm = iTime >= 0 && int.TryParse(f[iTime], NumberStyles.Integer, Inv, out var t) ? t : 0;
            var acquired = date.ToDateTime(new TimeOnly(Math.Min(hhmm / 100, 23), Math.Min(hhmm % 100, 59)), DateTimeKind.Utc);

            var (confPct, confClass) = ParseConfidence(iConf >= 0 ? f[iConf] : "");

            result.Add(new Hotspot(
                lat, lon, acquired,
                SatelliteName(iSat >= 0 ? f[iSat] : ""),
                iInst >= 0 ? f[iInst] : "",
                layerId, sourceId,
                confPct, confClass,
                Num(f, iFrp), Num(f, iBright),
                iDn >= 0 && f[iDn].Length > 0 ? f[iDn][0] : '?',
                Num(f, iScan), Num(f, iTrack),
                iType >= 0 && int.TryParse(f[iType], NumberStyles.Integer, Inv, out var ty) ? ty : null));
        }
        return result;
    }

    /// <summary>MODIS: 0–100 %. VIIRS: l/n/h. Mapped to one low/nominal/high scale (MODIS: &lt;30, 30–79, ≥80 per FIRMS FAQ).</summary>
    public static (int? Pct, string Class) ParseConfidence(string raw) => raw.Trim().ToLowerInvariant() switch
    {
        "l" or "low" => (null, ConfidenceClasses.Low),
        "n" or "nominal" => (null, ConfidenceClasses.Nominal),
        "h" or "high" => (null, ConfidenceClasses.High),
        var s when int.TryParse(s, NumberStyles.Integer, Inv, out var p) =>
            (p, p < 30 ? ConfidenceClasses.Low : p < 80 ? ConfidenceClasses.Nominal : ConfidenceClasses.High),
        _ => (null, ConfidenceClasses.Nominal),
    };

    public static string SatelliteName(string code) => code.Trim() switch
    {
        "N" or "NPP" => "Suomi NPP",
        "N20" or "1" => "NOAA-20",
        "N21" or "2" => "NOAA-21",
        "T" or "Terra" => "Terra",
        "A" or "Aqua" => "Aqua",
        var s => s,
    };

    private static double? Num(string[] f, int i) =>
        i >= 0 && double.TryParse(f[i], NumberStyles.Float, Inv, out var v) ? v : null;

    private static string Truncate(string s) => s.Length > 120 ? s[..120] + "…" : s;
}
