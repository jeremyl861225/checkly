// 待辦事項 — 桌面小工具的唯讀資料來源
//
// 小工具跑在 Scriptable 裡，沒有辦法登入，所以這支函式自己做驗證：
// 網址帶一個只有這個帳號才知道的 token，對到 widget_feeds 的那一列，
// 回傳 App 事先展開好的快照。因此 verify_jwt 必須關掉（改用 token 驗證）：
//
//   supabase functions deploy widget --no-verify-jwt
//
// 它只讀 widget_feeds.payload，不碰其他資料表，也不接受任何寫入。

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// token 由 App 用 crypto.getRandomValues 產生後轉 base64url，字元集固定
const TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      // 小工具每次更新都要拿到最新的，中間任何一層都不要留快取
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const token = (new URL(req.url).searchParams.get("t") || "").trim();
  // 格式不對就直接擋掉，不要拿去查資料庫
  if (!TOKEN_RE.test(token)) return json({ error: "bad_token" }, 400);

  let res: Response;
  try {
    res = await fetch(
      `${SB_URL}/rest/v1/widget_feeds?token=eq.${encodeURIComponent(token)}&select=payload,updated_at&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
    );
  } catch {
    return json({ error: "upstream_unreachable" }, 502);
  }
  if (!res.ok) return json({ error: "upstream_error" }, 502);

  const rows = await res.json();
  // 查無此 token 與 token 錯誤回同一種答案，不透露哪一個 token 存在
  if (!Array.isArray(rows) || rows.length === 0) return json({ error: "not_found" }, 404);

  const row = rows[0];
  const payload = (row && typeof row.payload === "object" && row.payload) || {};
  return json({ ...payload, updated_at: row?.updated_at ?? null });
});
