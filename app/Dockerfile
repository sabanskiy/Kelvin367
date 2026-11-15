# Runtime image for the Azure Container Apps trial (branch container-apps, workflow container-app.yml).
# The app is built and tested in the workflow; the build context is the `dotnet publish` output
# (docker build -f app/Dockerfile app/publish), so this image needs no SDK or Node.
# Settings come from environment variables only, so the app code is unchanged:
#   ASPNETCORE_FORWARDEDHEADERS_ENABLED  ingress ends HTTPS before the app; trust X-Forwarded-Proto/For
#   Firms__CacheDirectory                writable for the non-root user (absolute path wins in Program.cs)
#   Firms__MapKey                        set on the container app from a secret, never in the image
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY . .
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    Firms__CacheDirectory=/tmp/firms-cache
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "FireMap.Web.dll"]
