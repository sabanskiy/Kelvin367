using FireMap.Web.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace FireMap.Web.Infrastructure;

/// <summary>Maps domain exceptions to RFC 7807 problem responses for /api/* controllers.</summary>
public sealed class ApiExceptionFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (!context.HttpContext.Request.Path.StartsWithSegments("/api")) return;

        var (status, title) = context.Exception switch
        {
            ArgumentException => (StatusCodes.Status400BadRequest, "Invalid request"),
            KeyNotFoundException => (StatusCodes.Status404NotFound, "Not found"),
            QueryTooLargeException => (StatusCodes.Status422UnprocessableEntity, "Query too large"),
            _ => (0, ""),
        };
        if (status == 0) return;

        context.Result = new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = context.Exception.Message,
        }) { StatusCode = status };
        context.ExceptionHandled = true;
    }
}
