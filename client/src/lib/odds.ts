const API_BASE_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:5000";

export async function fetchVegasImpliedTotal(teamAbbrev: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/vegas-implied/${teamAbbrev.toUpperCase()}`);
    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const value = typeof data?.impliedTotal === "number" ? data.impliedTotal : null;
    return value;
  } catch (err) {
    console.error("Implied total fetch error:", err);
    return null;
  }
}
