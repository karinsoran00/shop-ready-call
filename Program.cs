using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using QRCoder;
using ShopReady;

var publicUrlFile = "";
var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

var app = builder.Build();

var shopName = builder.Configuration["Shop:Name"];
if (string.IsNullOrWhiteSpace(shopName))
    shopName = "Shop Ready-Call";
var reviewUrl = SafeHttpUrl(builder.Configuration["Shop:GoogleReviewUrl"]);

var dbPath = Path.Combine(app.Environment.ContentRootPath, "data", "orders.db");
publicUrlFile = Path.Combine(app.Environment.ContentRootPath, "data", "public-url.txt");
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
var db = new OrderDb(dbPath);
db.Init();

app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var name = ctx.File.Name;
        if (name.EndsWith(".html") || name.EndsWith(".js") || name.EndsWith(".css"))
            ctx.Context.Response.Headers.CacheControl = "no-cache";
    }
});

app.MapGet("/", () => Results.File(
    Path.Combine(app.Environment.WebRootPath, "index.html"),
    "text/html; charset=utf-8"));

app.MapGet("/staff", () => Results.Redirect("/staff.html"));

app.MapGet("/api/config", () => Results.Ok(new
{
    name = shopName,
    reviewUrl,
    pollSeconds = 2
}));

app.MapGet("/api/link", (HttpRequest request) =>
{
    var link = CustomerLink(request);
    return Results.Ok(new { url = link.Url, onThisComputerOnly = link.OnThisComputerOnly });
});

app.MapGet("/qr.png", (HttpRequest request) =>
{
    var link = CustomerLink(request);
    using var generator = new QRCodeGenerator();
    using var data = generator.CreateQrCode(link.Url, QRCodeGenerator.ECCLevel.Q);
    var png = new PngByteQRCode(data);
    var bytes = png.GetGraphic(10);
    return Results.File(bytes, "image/png");
});

app.MapGet("/api/orders", () => Results.Ok(db.List()));

app.MapGet("/api/orders/lookup", (string? number) =>
{
    if (!TryBillNumber(number, out var bill))
        return Results.BadRequest(new { error = "Type the bill number." });

    var order = db.FindByNumber(bill);
    return order is null ? Results.NotFound(new { error = "That number is not on the list." }) : Results.Ok(order);
});

app.MapPost("/api/orders", (NewOrder body) =>
{
    if (!TryBillNumber(body.Number, out var bill))
        return Results.BadRequest(new { error = "Type the bill number." });
    if (body.Minutes is < 1 or > 120)
        return Results.BadRequest(new { error = "Choose the minutes." });

    var order = db.Save(bill, body.Minutes);
    return Results.Ok(order);
});

app.MapPost("/api/orders/{id:long}/ready", (long id) =>
{
    var order = db.MarkReady(id);
    return order is null ? Results.NotFound(new { error = "That order is gone." }) : Results.Ok(order);
});

app.MapDelete("/api/orders/{id:long}", (long id) =>
    db.Remove(id) ? Results.NoContent() : Results.NotFound(new { error = "That order is gone." }));

app.Run();

static bool TryBillNumber(string? value, out string bill)
{
    bill = (value ?? "").Trim();
    if (bill.Length is < 1 or > 6)
        return false;
    foreach (var c in bill)
    {
        if (c is < '0' or > '9')
            return false;
    }
    return true;
}

static string SafeHttpUrl(string? value)
{
    var text = (value ?? "").Trim();
    if (Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http")
        return uri.ToString();
    return "";
}

CustomerLink CustomerLink(HttpRequest request)
{
    var published = PublishedUrl();
    if (published is not null)
        return new CustomerLink(published, false);

    var host = request.Host.Host;
    if (host is "localhost" or "127.0.0.1" or "0.0.0.0" or "::1")
    {
        var ip = FirstLanIp();
        if (ip is not null)
        {
            var port = request.Host.Port;
            var portPart = port is null ? "" : $":{port}";
            return new CustomerLink($"{request.Scheme}://{ip}{portPart}/", false);
        }

        return new CustomerLink($"{request.Scheme}://{request.Host}/", true);
    }

    return new CustomerLink($"{request.Scheme}://{request.Host}/", false);
}

string? PublishedUrl()
{
    if (string.IsNullOrEmpty(publicUrlFile) || !File.Exists(publicUrlFile))
        return null;
    var text = File.ReadAllText(publicUrlFile).Trim();
    if (Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http")
        return uri.GetLeftPart(UriPartial.Authority) + "/";
    return null;
}

static string? FirstLanIp()
{
    var found = new List<string>();
    foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
    {
        if (ni.OperationalStatus != OperationalStatus.Up)
            continue;
        if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            continue;

        var desc = ni.Description.ToLowerInvariant();
        if (desc.Contains("virtual") || desc.Contains("hyper-v") || desc.Contains("vmware") || desc.Contains("wsl"))
            continue;

        foreach (var address in ni.GetIPProperties().UnicastAddresses)
        {
            if (address.Address.AddressFamily != AddressFamily.InterNetwork)
                continue;
            if (IPAddress.IsLoopback(address.Address))
                continue;

            var text = address.Address.ToString();
            if (text.StartsWith("169.254.", StringComparison.Ordinal))
                continue;
            found.Add(text);
        }
    }

    string? best = null;
    var bestScore = int.MaxValue;
    foreach (var ip in found)
    {
        var score = ip.StartsWith("192.168.", StringComparison.Ordinal) ? 0
            : ip.StartsWith("10.", StringComparison.Ordinal) ? 1
            : ip.StartsWith("172.", StringComparison.Ordinal) ? 2
            : 3;
        if (score < bestScore)
        {
            bestScore = score;
            best = ip;
        }
    }

    return best;
}

sealed record NewOrder(string? Number, int Minutes);
sealed record CustomerLink(string Url, bool OnThisComputerOnly);
