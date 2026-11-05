
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8"
    }
  });

function randomHex(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return [...new Uint8Array(digest)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

async function getAccount(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer ([a-f0-9]{64})$/i);

  if (!match) return null;

  const tokenHash = await sha256(match[1]);

  return await env.DB.prepare(
    `SELECT id, nickname, credits, channel_reward_claimed, created_at
     FROM device_accounts
     WHERE auth_token_hash = ?`
  ).bind(tokenHash).first();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (!env.DB) {
      return json({
        ok: false,
        error: "database_binding_missing"
      }, 500);
    }

    // سلامت سرور
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "mafia-show-api",
        mode: "account-api-ready"
      });
    }

    // ساخت حساب جدید
    if (url.pathname === "/api/account/create" && request.method === "POST") {
      let body;

      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }

      const nickname =
        typeof body.nickname === "string"
          ? body.nickname.trim().slice(0, 20)
          : "";

      const safeNickname = nickname || "بازیکن";

      const accountId = crypto.randomUUID();
      const token = randomHex(32);
      const tokenHash = await sha256(token);
      const deviceHash = await sha256(randomHex(32));

      try {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO device_accounts
             (id, device_hash, auth_token_hash, nickname, credits)
             VALUES (?, ?, ?, ?, 5)`
          ).bind(
            accountId,
            deviceHash,
            tokenHash,
            safeNickname
          ),

          env.DB.prepare(
            `INSERT INTO credit_ledger
             (id, device_account_id, delta, reason)
             VALUES (?, ?, 5, 'welcome_bonus')`
          ).bind(
            crypto.randomUUID(),
            accountId
          )
        ]);

        return json({
          ok: true,
          token,
          profile: {
            id: accountId,
            nickname: safeNickname,
            credits: 5
          }
        }, 201);

      } catch {
        return json({
          ok: false,
          error: "account_create_failed",
          message: "Database operation failed."
        }, 500);
      }
    }

    // دریافت پروفایل
    if (url.pathname === "/api/profile" && request.method === "GET") {
      const account = await getAccount(request, env);

      if (!account) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      return json({
        ok: true,
        profile: account
      });
    }

    // تغییر نام بازیکن
    if (url.pathname === "/api/profile/nickname" && request.method === "POST") {
      const account = await getAccount(request, env);

      if (!account) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }

      const nickname =
        typeof body.nickname === "string"
          ? body.nickname.trim()
          : "";

      if (!nickname || nickname.length > 20) {
        return json({
          ok: false,
          error: "nickname_must_be_1_to_20_characters"
        }, 400);
      }

      await env.DB.prepare(
        `UPDATE device_accounts
         SET nickname = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(nickname, account.id).run();

      return json({
        ok: true,
        nickname
      });
    }

    // محصولات اعتبار
    if (url.pathname === "/api/products" && request.method === "GET") {
      return json({
        products: [
          { id: "kolahetbar10", credits: 10 },
          { id: "kolahetbar30", credits: 30 },
          { id: "kolahetbar100", credits: 100 },
          { id: "kolahetbar350", credits: 350 }
        ]
      });
    }

    // مسیرهای خرید و پاداش فعلاً غیرفعال‌اند
    if (
      [
        "/api/purchases/verify",
        "/api/roles/purchase",
        "/api/rewards/channel"
      ].includes(url.pathname)
    ) {
      return json({
        ok: false,
        error: "not_configured",
        message: "Payment and reward verification are not implemented yet."
      }, 501);
    }

    return json({
      ok: false,
      error: "not_found"
    }, 404);
  }
};
