using Microsoft.Extensions.Options;

namespace FireMap.Web.Services.Firms;

/// <summary>Raised instead of calling FIRMS when the transaction budget is (nearly) used up.</summary>
public sealed class FirmsQuotaException(string message) : Exception(message);

/// <summary>
/// Tracks FIRMS transactions in a sliding 10-minute window (FIRMS limit: 5000 / 10 min).
/// Local counting is combined with the server's own count from <c>mapkey_status</c> (polled by <see cref="FirmsStatusPoller"/>).
/// </summary>
public sealed class FirmsRateGuard(IOptions<FirmsOptions> options, TimeProvider time)
{
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    private readonly Queue<(DateTimeOffset At, int Cost)> _calls = new();
    private readonly Lock _lock = new();
    private int _localUsed;
    private int _remoteUsed;
    private int _remoteLimit = 5000;
    private DateTimeOffset _remoteAt = DateTimeOffset.MinValue;
    private DateTimeOffset _trippedUntil = DateTimeOffset.MinValue;

    private int SoftLimit => options.Value.SoftLimit;

    /// <param name="cost">Transactions this request will consume (FIRMS: 2 per day requested).</param>
    public bool TryAcquire(int cost = 1)
    {
        lock (_lock)
        {
            var now = time.GetUtcNow();
            if (now < _trippedUntil) return false;
            Prune(now);
            if (UsedUnlocked(now) + cost > SoftLimit) return false;
            _calls.Enqueue((now, cost));
            _localUsed += cost;
            return true;
        }
    }

    /// <summary>Stop calling FIRMS for a while (e.g. after HTTP 429/403).</summary>
    public void Trip(TimeSpan? duration = null)
    {
        lock (_lock) _trippedUntil = time.GetUtcNow() + (duration ?? Window);
    }

    public void UpdateRemote(int currentTransactions, int limit)
    {
        lock (_lock)
        {
            _remoteUsed = currentTransactions;
            _remoteLimit = limit;
            _remoteAt = time.GetUtcNow();
        }
    }

    public QuotaSnapshot Snapshot()
    {
        lock (_lock)
        {
            var now = time.GetUtcNow();
            Prune(now);
            return new QuotaSnapshot(UsedUnlocked(now), _remoteLimit, SoftLimit, _localUsed,
                now < _trippedUntil ? _trippedUntil : null,
                _remoteAt == DateTimeOffset.MinValue ? null : _remoteAt);
        }
    }

    private int UsedUnlocked(DateTimeOffset now)
    {
        // The remote figure already contains our own calls; it is only trusted while fresh.
        int remote = now - _remoteAt < TimeSpan.FromMinutes(5) ? _remoteUsed : 0;
        return Math.Max(_localUsed, remote);
    }

    private void Prune(DateTimeOffset now)
    {
        while (_calls.Count > 0 && now - _calls.Peek().At > Window) _localUsed -= _calls.Dequeue().Cost;
    }
}

public sealed record QuotaSnapshot(
    int TransactionsUsed, int Limit, int SoftLimit, int LocalTransactionsInWindow,
    DateTimeOffset? PausedUntil, DateTimeOffset? RemoteCheckedAt);
