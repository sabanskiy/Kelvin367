using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text.Json;
using FireMap.Web.Services.Caching;
using Microsoft.Extensions.Options;
using NetTopologySuite.Geometries;

namespace FireMap.Web.Services.Firms;

public sealed class FirmsApiException(string message, HttpStatusCode? status = null) : Exception(message)
{
    public HttpStatusCode? Status { get; } = status;
}

public sealed record MapKeyStatus(int CurrentTransactions, int TransactionLimit);

/// <summary>Raw HTTP access to FIRMS. No caching here — see <see cref="CachedFirmsClient"/>.</summary>
public sealed class FirmsClient
{
    public const string HttpClientName = "firms";

    private readonly IHttpClientFactory _http;
    private readonly IOptions<FirmsOptions> _options;
    private readonly FirmsRateGuard _guard;
    private readonly CacheMetrics _metrics;
    private readonly ILogger<FirmsClient> _log;
    private readonly SemaphoreSlim _gate;

    public FirmsClient(IHttpClientFactory http, IOptions<FirmsOptions> options, FirmsRateGuard guard,
        CacheMetrics metrics, ILogger<FirmsClient> log)
    {
        _http = http;
        _options = options;
        _guard = guard;
        _metrics = metrics;
        _log = log;
        _gate = new SemaphoreSlim(Math.Max(1, options.Value.MaxConcurrency));
    }

    private string Key => _options.Value.MapKey;

    public async Task<string> GetAreaCsvAsync(string sourceId, Envelope area, DateOnly start, int days, CancellationToken ct)
    {
        string bbox = string.Join(',', new[] { area.MinX, area.MinY, area.MaxX, area.MaxY }
            .Select(v => v.ToString("0.####", CultureInfo.InvariantCulture)));
        string path = $"api/area/csv/{Key}/{sourceId}/{bbox}/{days}/{start:yyyy-MM-dd}";

        await _gate.WaitAsync(ct);
        var sw = Stopwatch.StartNew();
        try
        {
            _metrics.UpstreamCall();
            using var resp = await _http.CreateClient(HttpClientName).GetAsync(path, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);

            if (resp.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.Forbidden)
            {
                _guard.Trip();
                throw new FirmsQuotaException($"FIRMS refused the request ({(int)resp.StatusCode}); pausing upstream calls.");
            }
            if (!resp.IsSuccessStatusCode)
                throw new FirmsApiException($"FIRMS {(int)resp.StatusCode}: {Short(body)}", resp.StatusCode);
            if (!FirmsCsvParser.LooksLikeFirmsCsv(body))
                throw new FirmsApiException($"FIRMS returned an unexpected body: {Short(body)}");

            _log.LogInformation("FIRMS call {Source} {Start}+{Days}d [{Bbox}] → {Bytes} B in {Ms} ms",
                sourceId, start, days, bbox, body.Length, sw.ElapsedMilliseconds);
            return body;
        }
        catch (Exception ex) when (ex is not FirmsQuotaException and not OperationCanceledException)
        {
            _metrics.UpstreamError();
            _log.LogWarning("FIRMS call failed {Source} {Start}+{Days}d [{Bbox}]: {Error}", sourceId, start, days, bbox, ex.Message);
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<string> GetAvailabilityCsvAsync(CancellationToken ct)
    {
        using var resp = await _http.CreateClient(HttpClientName).GetAsync($"api/data_availability/csv/{Key}/all", ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode || !body.StartsWith("data_id", StringComparison.Ordinal))
            throw new FirmsApiException($"data_availability failed: {Short(body)}", resp.StatusCode);
        return body;
    }

    public async Task<MapKeyStatus> GetMapKeyStatusAsync(CancellationToken ct)
    {
        using var resp = await _http.CreateClient(HttpClientName).GetAsync($"mapserver/mapkey_status/?MAP_KEY={Key}", ct);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        return new MapKeyStatus(
            root.TryGetProperty("current_transactions", out var c) && c.TryGetInt32(out var ci) ? ci : 0,
            root.TryGetProperty("transaction_limit", out var l) && l.TryGetInt32(out var li) ? li : 5000);
    }

    private static string Short(string s)
    {
        s = s.ReplaceLineEndings(" ").Trim();
        return s.Length > 200 ? s[..200] + "…" : s;
    }
}
