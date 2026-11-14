using System.Buffers.Binary;
using System.IO.Compression;
using Microsoft.Extensions.Caching.Distributed;

namespace FireMap.Web.Services.Caching;

/// <summary>
/// Disk-backed <see cref="IDistributedCache"/> used as HybridCache's L2: survives restarts and the folder can be
/// copied to a teammate's machine (or used offline at the hackathon).
/// Key "a:b:c" → {root}/a/b/c.gz. File = gzip( 8-byte expiry (UTC ticks) + payload ).
/// </summary>
public sealed class FileDistributedCache : IDistributedCache
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromDays(30);
    private readonly string _root;
    private readonly CacheMetrics _metrics;
    private readonly TimeProvider _time;
    private readonly ILogger<FileDistributedCache> _log;

    public FileDistributedCache(string root, CacheMetrics metrics, TimeProvider time, ILogger<FileDistributedCache> log)
    {
        _root = Path.GetFullPath(root);
        _metrics = metrics;
        _time = time;
        _log = log;
        Directory.CreateDirectory(_root);
    }

    public string Root => _root;

    public byte[]? Get(string key) => GetAsync(key).GetAwaiter().GetResult();

    public async Task<byte[]?> GetAsync(string key, CancellationToken token = default)
    {
        var path = PathFor(key);
        if (!File.Exists(path)) return null;
        try
        {
            await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 64 * 1024, useAsync: true);
            await using var gz = new GZipStream(file, CompressionMode.Decompress);
            using var ms = new MemoryStream();
            await gz.CopyToAsync(ms, token);
            var buffer = ms.GetBuffer().AsSpan(0, (int)ms.Length);
            if (buffer.Length < 8) return null;

            var expires = new DateTime(BinaryPrimitives.ReadInt64LittleEndian(buffer), DateTimeKind.Utc);
            if (expires <= _time.GetUtcNow().UtcDateTime)
            {
                TryDelete(path);
                return null;
            }
            _metrics.DiskHit();
            return buffer[8..].ToArray();
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            _log.LogWarning(ex, "Unreadable cache file {Path}; ignoring", path);
            return null;
        }
    }

    public void Set(string key, byte[] value, DistributedCacheEntryOptions options) =>
        SetAsync(key, value, options).GetAwaiter().GetResult();

    public async Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options, CancellationToken token = default)
    {
        var now = _time.GetUtcNow();
        var expires = options.AbsoluteExpiration
                      ?? now + (options.AbsoluteExpirationRelativeToNow ?? options.SlidingExpiration ?? DefaultTtl);

        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + "." + Guid.NewGuid().ToString("N")[..8] + ".tmp";
        try
        {
            await using (var file = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
            await using (var gz = new GZipStream(file, CompressionLevel.Fastest))
            {
                var header = new byte[8];
                BinaryPrimitives.WriteInt64LittleEndian(header, expires.UtcDateTime.Ticks);
                await gz.WriteAsync(header, token);
                await gz.WriteAsync(value, token);
            }
            File.Move(tmp, path, overwrite: true);
            _metrics.DiskWrite();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _log.LogWarning(ex, "Could not write cache file {Path}", path);
            TryDelete(tmp);
        }
    }

    public void Refresh(string key) { }
    public Task RefreshAsync(string key, CancellationToken token = default) => Task.CompletedTask;

    public void Remove(string key) => TryDelete(PathFor(key));

    public Task RemoveAsync(string key, CancellationToken token = default)
    {
        Remove(key);
        return Task.CompletedTask;
    }

    /// <summary>Delete files under an optional key prefix (e.g. "firms:MODIS_NRT"), optionally only those written before a date.</summary>
    public int Purge(string? keyPrefix, DateTime? writtenBeforeUtc)
    {
        var dir = keyPrefix is null ? _root : Path.Combine(_root, Path.Combine(keyPrefix.Split(':').Select(Sanitize).ToArray()));
        if (!Directory.Exists(dir)) return 0;
        int n = 0;
        foreach (var f in Directory.EnumerateFiles(dir, "*.gz", SearchOption.AllDirectories))
        {
            if (writtenBeforeUtc is { } before && File.GetLastWriteTimeUtc(f) >= before) continue;
            if (TryDelete(f)) n++;
        }
        return n;
    }

    public (int Files, long Bytes) Usage()
    {
        int files = 0;
        long bytes = 0;
        foreach (var f in new DirectoryInfo(_root).EnumerateFiles("*.gz", SearchOption.AllDirectories))
        {
            files++;
            bytes += f.Length;
        }
        return (files, bytes);
    }

    private string PathFor(string key)
    {
        var parts = key.Split(':').Select(Sanitize).ToArray();
        parts[^1] += ".gz";
        return Path.Combine(_root, Path.Combine(parts));
    }

    private static string Sanitize(string segment)
    {
        if (segment is "" or "." or "..") return "_";
        var invalid = Path.GetInvalidFileNameChars();
        return new string(segment.Select(c => Array.IndexOf(invalid, c) >= 0 ? '_' : c).ToArray());
    }

    private static bool TryDelete(string path)
    {
        try
        {
            File.Delete(path);
            return true;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }
}
