namespace FireMap.Web.Services.Firms;

public sealed class FirmsOptions
{
    public const string Section = "Firms";

    public string BaseUrl { get; set; } = "https://firms.modaps.eosdis.nasa.gov";

    /// <summary>Keep it out of appsettings: <c>dotnet user-secrets set Firms:MapKey &lt;key&gt;</c>. Empty → sample data mode.</summary>
    public string MapKey { get; set; } = "";

    /// <summary>
    /// Cache grid cell size in degrees (must divide 180). FIRMS charges per *day*, not per area
    /// (measured 2026-11-13: 2 transactions per day regardless of bbox size or row count), so large tiles are cheap.
    /// </summary>
    public double TileSizeDeg { get; set; } = 30;

    /// <summary>
    /// Days per upstream request (FIRMS accepts 1..5). Cost is linear in days, so 1-day chunks never pay for
    /// days the user did not ask for and give perfect per-day cache reuse.
    /// </summary>
    public int ChunkDays { get; set; } = 1;

    /// <summary>FIRMS cost of one day in one area request (measured 2026-11-13).</summary>
    public int TransactionsPerDay { get; set; } = 2;

    /// <summary>Upper bound of tiles per provider call (map view or country). Protects the transaction quota.</summary>
    public int MaxTilesPerQuery { get; set; } = 40;

    public int MaxConcurrency { get; set; } = 6;

    /// <summary>FIRMS limit is 5000 / 10 min; stop calling upstream above this many.</summary>
    public int SoftLimit { get; set; } = 4000;

    public int RecentTtlMinutes { get; set; } = 20;
    public int ImmutableTtlDays { get; set; } = 30;
    public int AvailabilityTtlHours { get; set; } = 6;
    public int StatusPollSeconds { get; set; } = 120;

    /// <summary>NRT chunks whose last day is older than this many days are treated as immutable.</summary>
    public int NrtSettleDays { get; set; } = 2;

    public string CacheDirectory { get; set; } = "App_Data/firms-cache";

    public bool IsLive => !string.IsNullOrWhiteSpace(MapKey);
}

public sealed class ApiOptions
{
    public const string Section = "Api";

    public int MaxRangeDays { get; set; } = 31;
    public int MaxPointsPerResponse { get; set; } = 50_000;

    /// <summary>Frontend won't request map points when the view touches more cache tiles than this.</summary>
    public int MapMaxTiles { get; set; } = 24;

    /// <summary>
    /// Grid the frontend snaps its request bbox to, so small pans reuse the same URL (browser cache).
    /// Finer than the server tiles to keep responses small.
    /// </summary>
    public double RequestGridDeg { get; set; } = 5;
}
