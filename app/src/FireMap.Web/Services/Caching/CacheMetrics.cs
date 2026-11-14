namespace FireMap.Web.Services.Caching;

/// <summary>Counters shown by /api/status. Hits = Lookups − UpstreamCalls (L1 or L2 served the tile).</summary>
public sealed class CacheMetrics
{
    private long _lookups, _upstreamCalls, _upstreamErrors, _diskHits, _diskWrites, _quotaRejections;

    public void Lookup() => Interlocked.Increment(ref _lookups);
    public void UpstreamCall() => Interlocked.Increment(ref _upstreamCalls);
    public void UpstreamError() => Interlocked.Increment(ref _upstreamErrors);
    public void DiskHit() => Interlocked.Increment(ref _diskHits);
    public void DiskWrite() => Interlocked.Increment(ref _diskWrites);
    public void QuotaRejection() => Interlocked.Increment(ref _quotaRejections);

    public object Snapshot()
    {
        long lookups = Interlocked.Read(ref _lookups), calls = Interlocked.Read(ref _upstreamCalls);
        return new
        {
            lookups,
            hits = Math.Max(0, lookups - calls),
            upstreamCalls = calls,
            upstreamErrors = Interlocked.Read(ref _upstreamErrors),
            diskHits = Interlocked.Read(ref _diskHits),
            diskWrites = Interlocked.Read(ref _diskWrites),
            quotaRejections = Interlocked.Read(ref _quotaRejections),
        };
    }
}
