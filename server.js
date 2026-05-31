const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

loadDotEnv();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const pointPackages = {
  points_69: { amount: 690, points: 20, name: "体验包" },
  points_199: { amount: 1990, points: 80, name: "标准包" },
  points_399: { amount: 3990, points: 200, name: "高级包" },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "GET" && req.url === "/api/me") {
      handleMe(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/code") {
      await handleAuthCode(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/login-code") {
      await handleLoginCode(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/login-password") {
      await handleLoginPassword(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/set-password") {
      await handleSetPassword(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/auth/logout") {
      handleLogout(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/payment/mock-pay") {
      await handleMockPay(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/payment/alipay/create") {
      await handleAlipayCreate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/payment/alipay/notify") {
      await handleAlipayNotify(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/payment/alipay/sync") {
      await handleAlipaySync(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/generate/text-avatar") {
      await handleTextAvatar(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`AI头像工厂 running at http://${host}:${port}`);
});

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function defaultDb() {
  return {
    users: [],
    pointAccounts: [],
    pointTransactions: [],
    orders: [],
    sessions: [],
    smsCodes: [],
  };
}

function readDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    const fresh = defaultDb();
    fs.writeFileSync(dbPath, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  return { ...defaultDb(), ...JSON.parse(fs.readFileSync(dbPath, "utf8")) };
}

function writeDb(db) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function assertPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!/^(\+?86)?1\d{10}$/.test(normalized)) {
    throw new HttpError(400, "手机号格式不对。先支持中国大陆 11 位手机号。");
  }
  return normalized.replace(/^\+?86/, "");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (!password || String(password).length < 8) {
    throw new HttpError(400, "密码至少 8 位。别拿 12345678 糊弄自己。");
  }
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const found = raw
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}

function setSessionCookie(res, sid) {
  res.setHeader("set-cookie", `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getSessionUser(req, db = readDb()) {
  const sid = getCookie(req, "sid");
  if (!sid) return null;
  const session = db.sessions.find((item) => item.id === sid && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function findOrCreateUser(db, phone) {
  let user = db.users.find((item) => item.phone === phone);
  if (user) return user;
  const userId = id("user");
  user = {
    id: userId,
    phone,
    createdAt: now(),
    updatedAt: now(),
  };
  db.users.push(user);
  db.pointAccounts.push({
    id: id("pa"),
    userId,
    balance: 6,
    totalRecharged: 0,
    totalConsumed: 0,
    createdAt: now(),
    updatedAt: now(),
  });
  db.pointTransactions.unshift({
    id: id("pt"),
    userId,
    type: "gift",
    points: 6,
    description: "新用户赠送 6 点",
    createdAt: now(),
  });
  return user;
}

function accountFor(db, userId) {
  let account = db.pointAccounts.find((item) => item.userId === userId);
  if (!account) {
    account = { id: id("pa"), userId, balance: 0, totalRecharged: 0, totalConsumed: 0, createdAt: now(), updatedAt: now() };
    db.pointAccounts.push(account);
  }
  return account;
}

function createSession(db, userId) {
  const sid = id("sid");
  db.sessions.push({
    id: sid,
    userId,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  });
  return sid;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, phone: maskPhone(user.phone), hasPassword: Boolean(user.passwordHash), createdAt: user.createdAt };
}

function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function mePayload(db, user) {
  const account = user ? accountFor(db, user.id) : null;
  return {
    user: publicUser(user),
    balance: account?.balance || 0,
    totalRecharged: account?.totalRecharged || 0,
    totalConsumed: account?.totalConsumed || 0,
    transactions: user ? db.pointTransactions.filter((item) => item.userId === user.id).slice(0, 50) : [],
    orders: user ? db.orders.filter((item) => item.userId === user.id).slice(0, 30) : [],
  };
}

function handleMe(req, res) {
  const db = readDb();
  const user = getSessionUser(req, db);
  sendJson(res, 200, mePayload(db, user));
}

async function handleAuthCode(req, res) {
  const body = await readJson(req);
  const phone = assertPhone(body.phone);
  const db = readDb();
  const code = String(100000 + crypto.randomInt(900000));
  db.smsCodes = db.smsCodes.filter((item) => item.phone !== phone || new Date(item.expiresAt) > new Date());
  db.smsCodes.push({
    id: id("sms"),
    phone,
    code,
    purpose: body.purpose || "login",
    used: false,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
  });
  writeDb(db);
  sendJson(res, 200, {
    ok: true,
    message: "验证码已生成。MVP 暂未接短信服务，先在页面显示验证码。",
    devCode: code,
  });
}

function verifySmsCode(db, phone, code) {
  const record = [...db.smsCodes]
    .reverse()
    .find((item) => item.phone === phone && item.code === String(code || "") && !item.used && new Date(item.expiresAt) > new Date());
  if (!record) throw new HttpError(400, "验证码错误或已过期。");
  record.used = true;
  record.usedAt = now();
}

async function handleLoginCode(req, res) {
  const body = await readJson(req);
  const phone = assertPhone(body.phone);
  const db = readDb();
  verifySmsCode(db, phone, body.code);
  const user = findOrCreateUser(db, phone);
  user.updatedAt = now();
  const sid = createSession(db, user.id);
  writeDb(db);
  setSessionCookie(res, sid);
  sendJson(res, 200, mePayload(db, user));
}

async function handleLoginPassword(req, res) {
  const body = await readJson(req);
  const phone = assertPhone(body.phone);
  const db = readDb();
  const user = db.users.find((item) => item.phone === phone);
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    throw new HttpError(401, "手机号或密码错误。");
  }
  const sid = createSession(db, user.id);
  writeDb(db);
  setSessionCookie(res, sid);
  sendJson(res, 200, mePayload(db, user));
}

async function handleSetPassword(req, res) {
  const body = await readJson(req);
  const phone = assertPhone(body.phone);
  const db = readDb();
  verifySmsCode(db, phone, body.code);
  const user = findOrCreateUser(db, phone);
  user.passwordHash = hashPassword(body.password);
  user.updatedAt = now();
  const sid = createSession(db, user.id);
  writeDb(db);
  setSessionCookie(res, sid);
  sendJson(res, 200, mePayload(db, user));
}

function handleLogout(req, res) {
  const db = readDb();
  const sid = getCookie(req, "sid");
  db.sessions = db.sessions.filter((item) => item.id !== sid);
  writeDb(db);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function handleMockPay(req, res) {
  const body = await readJson(req);
  const pkg = pointPackages[body.packageId];
  if (!pkg) throw new HttpError(400, "未知点数套餐。");
  const db = readDb();
  const user = getSessionUser(req, db);
  if (!user) throw new HttpError(401, "充值前请先登录。");
  const orderId = id("order");
  db.orders.unshift({
    id: orderId,
    userId: user.id,
    packageId: body.packageId,
    amount: pkg.amount,
    points: pkg.points,
    status: "paid",
    paymentProvider: "mock",
    paymentTradeNo: id("mock_trade"),
    createdAt: now(),
    paidAt: now(),
    updatedAt: now(),
  });
  const account = accountFor(db, user.id);
  account.balance += pkg.points;
  account.totalRecharged += pkg.points;
  account.updatedAt = now();
  db.pointTransactions.unshift({
    id: id("pt"),
    userId: user.id,
    type: "recharge",
    points: pkg.points,
    relatedOrderId: orderId,
    description: `充值到账：${pkg.points} 点`,
    createdAt: now(),
  });
  writeDb(db);
  sendJson(res, 200, mePayload(db, user));
}

async function handleAlipayCreate(req, res) {
  const body = await readJson(req);
  const pkg = pointPackages[body.packageId];
  if (!pkg) throw new HttpError(400, "未知点数套餐。");
  assertAlipayConfig();

  const db = readDb();
  const user = getSessionUser(req, db);
  if (!user) throw new HttpError(401, "充值前请先登录。");

  const orderId = id("order");
  db.orders.unshift({
    id: orderId,
    userId: user.id,
    packageId: body.packageId,
    amount: pkg.amount,
    points: pkg.points,
    status: "pending",
    paymentProvider: "alipay",
    createdAt: now(),
    updatedAt: now(),
  });
  writeDb(db);

  const bizContent = {
    out_trade_no: orderId,
    total_amount: (pkg.amount / 100).toFixed(2),
    subject: `AI头像工厂-${pkg.name}`,
    product_code: "FAST_INSTANT_TRADE_PAY",
    body: `${pkg.points} 点`,
  };
  const params = {
    app_id: process.env.ALIPAY_APP_ID,
    method: "alipay.trade.page.pay",
    charset: "UTF-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    notify_url: process.env.ALIPAY_NOTIFY_URL,
    return_url: process.env.ALIPAY_RETURN_URL,
    biz_content: JSON.stringify(bizContent),
  };
  params.sign = signAlipay(params);

  sendJson(res, 200, {
    orderId,
    paymentProvider: "alipay",
    paymentForm: buildAutoSubmitForm(process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do", params),
  });
}

async function handleAlipayNotify(req, res) {
  const raw = await readBody(req);
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!verifyAlipay(params)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("failure");
    return;
  }
  const orderId = params.out_trade_no;
  const tradeStatus = params.trade_status;
  const tradeNo = params.trade_no;
  const totalAmount = Number(params.total_amount);
  const db = readDb();
  const order = db.orders.find((item) => item.id === orderId);
  if (!order) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("failure");
    return;
  }
  if (Number((order.amount / 100).toFixed(2)) !== totalAmount) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("failure");
    return;
  }
  if (isPaidAlipayStatus(tradeStatus)) {
    markAlipayOrderPaid(db, order, tradeNo);
    writeDb(db);
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("success");
}

async function handleAlipaySync(req, res) {
  assertAlipayConfig();
  const body = await readJson(req);
  const outTradeNo = String(body.outTradeNo || body.out_trade_no || "").trim();
  const tradeNo = String(body.tradeNo || body.trade_no || "").trim();
  if (!outTradeNo && !tradeNo) throw new HttpError(400, "缺少支付宝订单号。");

  const db = readDb();
  const user = getSessionUser(req, db);
  if (!user) throw new HttpError(401, "请先登录后再同步订单。");

  const query = await queryAlipayTrade({ outTradeNo, tradeNo });
  if (query.code !== "10000") throw new HttpError(400, query.sub_msg || query.msg || "支付宝查单失败。");
  if (!isPaidAlipayStatus(query.trade_status)) throw new HttpError(400, "支付宝交易还不是支付成功状态。");

  const paidTradeNo = query.trade_no || tradeNo;
  const paidOutTradeNo = query.out_trade_no || outTradeNo;
  const totalAmount = Number(query.total_amount);
  let order = db.orders.find((item) => item.id === paidOutTradeNo || item.paymentTradeNo === paidTradeNo);

  if (!order) {
    const pkg = packageByAmount(totalAmount);
    if (!pkg) throw new HttpError(400, "已支付金额和当前点数套餐不匹配，无法自动补单。");
    order = {
      id: paidOutTradeNo || id("order"),
      userId: user.id,
      packageId: pkg.id,
      amount: pkg.amount,
      points: pkg.points,
      status: "pending",
      paymentProvider: "alipay",
      createdAt: now(),
      updatedAt: now(),
      recovered: true,
    };
    db.orders.unshift(order);
  }

  if (order.userId !== user.id) throw new HttpError(403, "这笔订单不属于当前登录账户。");
  if (Number((order.amount / 100).toFixed(2)) !== totalAmount) throw new HttpError(400, "订单金额和支付宝支付金额不一致。");

  markAlipayOrderPaid(db, order, paidTradeNo);
  writeDb(db);
  sendJson(res, 200, mePayload(db, user));
}

function isPaidAlipayStatus(status) {
  return status === "TRADE_SUCCESS" || status === "TRADE_FINISHED";
}

function markAlipayOrderPaid(db, order, tradeNo) {
  if (order.status === "paid") return;
  order.status = "paid";
  order.paymentTradeNo = tradeNo;
  order.paidAt = now();
  order.updatedAt = now();
  const account = accountFor(db, order.userId);
  account.balance += order.points;
  account.totalRecharged += order.points;
  account.updatedAt = now();
  db.pointTransactions.unshift({
    id: id("pt"),
    userId: order.userId,
    type: "recharge",
    points: order.points,
    relatedOrderId: order.id,
    description: `支付宝充值到账：${order.points} 点`,
    createdAt: now(),
  });
}

function packageByAmount(totalAmount) {
  const cents = Math.round(Number(totalAmount) * 100);
  const entry = Object.entries(pointPackages).find(([, pkg]) => pkg.amount === cents);
  if (!entry) return null;
  return { id: entry[0], ...entry[1] };
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": mime[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function assertAlipayConfig() {
  const missing = ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_NOTIFY_URL", "ALIPAY_RETURN_URL"].filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(400, `支付宝配置缺失：${missing.join(", ")}`);
}

function normalizePrivateKey(value) {
  const raw = String(value || "").replace(/\\n/g, "\n").trim();
  if (raw.includes("BEGIN")) return raw;
  return `-----BEGIN PRIVATE KEY-----\n${raw.match(/.{1,64}/g)?.join("\n") || raw}\n-----END PRIVATE KEY-----`;
}

function normalizePublicKey(value) {
  const raw = String(value || "").replace(/\\n/g, "\n").trim();
  if (raw.includes("BEGIN")) return raw;
  return `-----BEGIN PUBLIC KEY-----\n${raw.match(/.{1,64}/g)?.join("\n") || raw}\n-----END PUBLIC KEY-----`;
}

function alipayTimestamp(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function alipaySignContent(params) {
  return Object.keys(params)
    .filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function alipayNotifySignContent(params) {
  return Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function signAlipay(params) {
  return crypto.createSign("RSA-SHA256").update(alipaySignContent(params), "utf8").sign(normalizePrivateKey(process.env.ALIPAY_PRIVATE_KEY), "base64");
}

async function queryAlipayTrade({ outTradeNo, tradeNo }) {
  const bizContent = {};
  if (outTradeNo) bizContent.out_trade_no = outTradeNo;
  if (tradeNo) bizContent.trade_no = tradeNo;
  const params = {
    app_id: process.env.ALIPAY_APP_ID,
    method: "alipay.trade.query",
    charset: "UTF-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
  params.sign = signAlipay(params);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const response = await fetch(`${process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do"}?${query.toString()}`);
  const data = await response.json();
  return data.alipay_trade_query_response || {};
}

function verifyAlipay(params) {
  if (!params.sign) return false;
  try {
    return crypto
      .createVerify("RSA-SHA256")
      .update(alipayNotifySignContent(params), "utf8")
      .verify(normalizePublicKey(process.env.ALIPAY_PUBLIC_KEY), params.sign, "base64");
  } catch {
    return false;
  }
}

function buildAutoSubmitForm(action, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }
  const paymentUrl = `${action}?${query.toString()}`;
  return `<!doctype html><html><head><meta charset="UTF-8"><title>跳转支付宝</title></head><body><script>location.replace(${JSON.stringify(paymentUrl)});</script></body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleTextAvatar(req, res) {
  const body = await readJson(req);
  const db = readDb();
  const user = getSessionUser(req, db);
  if (!user) throw new HttpError(401, "请先用手机号登录。");
  const account = accountFor(db, user.id);
  if (account.balance < 2) throw new HttpError(402, "点数不足，请先充值。");

  const taskId = id("task");
  consumePoints(db, user.id, 2, "文字生成头像，2 张", taskId);
  writeDb(db);

  try {
    let outputs;
    if ((process.env.IMAGE_PROVIDER || "openai").toLowerCase() === "coze") {
      outputs = await generateWithCoze(body);
    } else {
      outputs = await generateWithOpenAI(body);
    }
    sendJson(res, 200, { outputs, taskId });
  } catch (error) {
    const refundDb = readDb();
    refundPoints(refundDb, user.id, 2, "AI 生成失败，自动退点", taskId);
    writeDb(refundDb);
    throw error;
  }
}

function consumePoints(db, userId, points, description, relatedTaskId) {
  const account = accountFor(db, userId);
  account.balance -= points;
  account.totalConsumed += points;
  account.updatedAt = now();
  db.pointTransactions.unshift({
    id: id("pt"),
    userId,
    type: "consume",
    points,
    relatedTaskId,
    description,
    createdAt: now(),
  });
}

function refundPoints(db, userId, points, description, relatedTaskId) {
  const account = accountFor(db, userId);
  account.balance += points;
  account.updatedAt = now();
  db.pointTransactions.unshift({
    id: id("pt"),
    userId,
    type: "refund",
    points,
    relatedTaskId,
    description,
    createdAt: now(),
  });
}

async function generateWithOpenAI(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpError(400, "缺少 OPENAI_API_KEY。把 key 放进 .env 后重启服务。");
  }

  const prompt = buildAvatarPrompt(body);
  const outputs = [];

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
        prompt: `${prompt}\nVariant ${index + 1}: keep the same brief, change pose and visual details.`,
        size: "1024x1024",
        quality: process.env.OPENAI_IMAGE_QUALITY || "low",
        output_format: "png",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || `OpenAI image request failed: ${response.status}`;
      throw new HttpError(response.status, message);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      throw new HttpError(502, "OpenAI 没有返回图片数据。");
    }
    outputs.push(`data:image/png;base64,${b64}`);
  }

  return outputs;
}

async function generateWithCoze(body) {
  const token = process.env.COZE_PAT;
  const runUrl = process.env.COZE_RUN_URL;
  const workflowId = process.env.COZE_WORKFLOW_ID;
  const baseURL = process.env.COZE_BASE_URL || "https://api.coze.cn";
  if (!token || token.includes("your-token")) {
    throw new HttpError(400, "缺少 COZE_PAT。把扣子 Personal Access Token 放进 .env 后重启服务。");
  }
  if ((!runUrl || runUrl.includes("your-space")) && (!workflowId || workflowId.includes("your-workflow"))) {
    throw new HttpError(400, "缺少 COZE_RUN_URL 或 COZE_WORKFLOW_ID。把扣子运行地址放进 .env 后重启服务。");
  }

  const prompt = buildAvatarPrompt(body);
  const parameters = {
    prompt,
    user_prompt: body.prompt || "",
    style: body.style || "不限",
    gender: body.gender || "不限",
    background: body.background || "不限",
    count: 2,
  };

  const response = await fetch(runUrl || `${baseURL.replace(/\/$/, "")}/v1/workflow/run`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      runUrl
        ? parameters
        : {
            workflow_id: workflowId,
            parameters: JSON.stringify(parameters),
          },
    ),
  });

  const payload = await response.json();
  if (!response.ok || (Object.hasOwn(payload, "code") && payload.code !== 0)) {
    throw new HttpError(response.status || 502, payload.msg || payload.message || `扣子工作流调用失败：${payload.code || response.status}`);
  }

  const urls = extractCozeImageUrls(payload);
  if (!urls.length) {
    throw new HttpError(502, "扣子工作流成功了，但没有找到图片 URL。检查结束节点输出字段，建议输出 image_url 或 image_urls。");
  }

  return urls.slice(0, 2);
}

function extractCozeImageUrls(payload) {
  const outputKey = process.env.COZE_OUTPUT_KEY || "image_url";
  const raw = typeof payload.data === "string" ? safeJson(payload.data) : payload.data;
  const candidates = [
    payload?.[outputKey],
    payload?.image_url,
    payload?.image_urls,
    payload?.url,
    raw?.[outputKey],
    raw?.image_urls,
    raw?.images,
    raw?.urls,
    raw?.url,
    raw?.output,
    raw,
  ];
  return candidates.flatMap(normalizeUrls).filter(Boolean);
}

function normalizeUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(normalizeUrls);
  if (typeof value === "object") return normalizeUrls(value.url || value.image_url || value.file_url);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (/^https?:\/\//.test(trimmed) || /^data:image\//.test(trimmed)) return [trimmed];
  const matches = trimmed.match(/https?:\/\/[^\s"'<>\\]+/g);
  return matches || [];
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildAvatarPrompt(body) {
  const style = body.style && body.style !== "不限" ? body.style : "clean modern avatar";
  const gender = body.gender && body.gender !== "不限" ? `${body.gender} leaning` : "gender neutral if unspecified";
  const background = body.background && body.background !== "不限" ? `${body.background} background` : "simple clean background";
  return [
    "Create a polished square profile avatar for social media.",
    `User description: ${body.prompt || ""}`,
    `Style: ${style}.`,
    `Gender tendency: ${gender}.`,
    `Background: ${background}.`,
    "Composition: centered head-and-shoulders portrait, clear face, appealing lighting, production-ready.",
    "Do not include text, logos, watermarks, political symbols, gore, nudity, or celebrity impersonation.",
  ].join("\n");
}

function readJson(req) {
  return readBody(req).then((raw) => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("Invalid JSON");
    }
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(raw));
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
