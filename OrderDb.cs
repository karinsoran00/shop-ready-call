using Microsoft.Data.Sqlite;

namespace ShopReady;

/// <summary>
/// One row per bill number. Status is waiting or ready.
/// </summary>
sealed class OrderDb
{
    private readonly string _connectionString;

    public OrderDb(string path)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = path }.ToString();
    }

    public void Init()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            CREATE TABLE IF NOT EXISTS Orders (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                BillNumber TEXT NOT NULL UNIQUE,
                Minutes INTEGER NOT NULL,
                Status TEXT NOT NULL,
                CreatedAt TEXT NOT NULL,
                ReadyAt TEXT NULL
            );
            """;
        cmd.ExecuteNonQuery();
    }

    public IReadOnlyList<Order> List()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            SELECT Id, BillNumber, Minutes, Status, CreatedAt, ReadyAt
            FROM Orders
            ORDER BY CASE Status WHEN 'waiting' THEN 0 ELSE 1 END,
                     CreatedAt;
            """;
        return ReadAll(cmd);
    }

    public Order Save(string billNumber, int minutes)
    {
        var created = DateTimeOffset.UtcNow.ToString("O");
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            INSERT INTO Orders (BillNumber, Minutes, Status, CreatedAt, ReadyAt)
            VALUES ($number, $minutes, 'waiting', $created, NULL)
            ON CONFLICT(BillNumber) DO UPDATE SET
                Minutes = excluded.Minutes,
                Status = 'waiting',
                CreatedAt = excluded.CreatedAt,
                ReadyAt = NULL;
            """;
        cmd.Parameters.AddWithValue("$number", billNumber);
        cmd.Parameters.AddWithValue("$minutes", minutes);
        cmd.Parameters.AddWithValue("$created", created);
        cmd.ExecuteNonQuery();
        return FindByNumber(conn, billNumber)!;
    }

    public Order? MarkReady(long id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            UPDATE Orders
            SET Status = 'ready',
                ReadyAt = CASE WHEN Status = 'ready' THEN ReadyAt ELSE $ready END
            WHERE Id = $id;
            """;
        cmd.Parameters.AddWithValue("$ready", DateTimeOffset.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
        return FindById(conn, id);
    }

    public bool Remove(long id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM Orders WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", id);
        return cmd.ExecuteNonQuery() > 0;
    }

    public Order? FindByNumber(string billNumber)
    {
        using var conn = Open();
        return FindByNumber(conn, billNumber);
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private static Order? FindByNumber(SqliteConnection conn, string billNumber)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            SELECT Id, BillNumber, Minutes, Status, CreatedAt, ReadyAt
            FROM Orders
            WHERE BillNumber = $number;
            """;
        cmd.Parameters.AddWithValue("$number", billNumber);
        return ReadAll(cmd).FirstOrDefault();
    }

    private static Order? FindById(SqliteConnection conn, long id)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            SELECT Id, BillNumber, Minutes, Status, CreatedAt, ReadyAt
            FROM Orders
            WHERE Id = $id;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        return ReadAll(cmd).FirstOrDefault();
    }

    private static List<Order> ReadAll(SqliteCommand cmd)
    {
        var rows = new List<Order>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var created = DateTimeOffset.Parse(reader.GetString(4));
            DateTimeOffset? ready = reader.IsDBNull(5) ? null : DateTimeOffset.Parse(reader.GetString(5));
            var minutes = reader.GetInt32(2);
            var status = reader.GetString(3);
            var remaining = 0;
            if (status == "waiting")
            {
                var end = created.AddMinutes(minutes);
                var seconds = (int)Math.Ceiling((end - DateTimeOffset.UtcNow).TotalSeconds);
                remaining = Math.Max(0, seconds);
            }

            rows.Add(new Order
            {
                Id = reader.GetInt64(0),
                BillNumber = reader.GetString(1),
                Minutes = minutes,
                Status = status,
                CreatedAt = created,
                ReadyAt = ready,
                RemainingSeconds = remaining
            });
        }

        return rows;
    }
}

sealed class Order
{
    public long Id { get; init; }
    public string BillNumber { get; init; } = "";
    public int Minutes { get; init; }
    public string Status { get; init; } = "waiting";
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? ReadyAt { get; init; }
    public int RemainingSeconds { get; init; }
}
