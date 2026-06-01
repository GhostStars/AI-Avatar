const STORE_KEY = "ai-avatar-factory-mvp";
let memoryStore = "";

const storage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return key === STORE_KEY ? memoryStore : null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      if (key === STORE_KEY) memoryStore = value;
    }
  },
};

const COST = {
  text: 2,
  textHd: 1,
  gif: 8,
  gifHd: 2,
};

const PACKAGES = [
  { id: "points_69", name: "体验包", price: "¥6.9", amount: 690, points: 20 },
  { id: "points_199", name: "标准包", price: "¥19.9", amount: 1990, points: 80, recommended: true },
  { id: "points_399", name: "高级包", price: "¥39.9", amount: 3990, points: 200 },
];

const AD_SLOTS = [
  { id: "home_mid", label: "首页信息流广告位", providers: "Google AdSense / 穿山甲 / 优量汇" },
  { id: "tool_side", label: "生成页侧边广告位", providers: "Google AdSense / 百度联盟" },
  { id: "result_bottom", label: "结果页底部广告位", providers: "Google AdSense / 国内信息流" },
];

const styles = ["不限", "写实", "二次元", "Q版", "赛博朋克", "商务职业", "情侣头像"];
const genders = ["不限", "男", "女"];
const backgrounds = ["不限", "白底", "渐变", "纯色"];
const motions = [
  { id: "blink", label: "眨眼" },
  { id: "smile", label: "微笑" },
  { id: "nod", label: "轻微点头" },
];

let state;
let serverMe = null;
let authMode = "code";
let formState = {
  style: "不限",
  gender: "不限",
  background: "不限",
  motion: "blink",
  uploadData: "",
  authorized: false,
};
let loadingTimer = null;
let paymentSyncPromise = null;

const loadingLines = [
  "正在把提示词拆成可见元素：脸、光、衣服、背景。",
  "正在让画面避开廉价感。头像不是贴纸，脸要能用。",
  "正在压缩风格漂移，别让樱花园长成宇宙赌场。",
  "正在等生成服务吐图。这里慢，不代表它死了。",
];

window.addEventListener("error", (event) => showFatal(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => showFatal(event.reason));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败。");
  return data;
}

async function refreshMe() {
  if (location.protocol === "file:") return null;
  try {
    serverMe = await api("/api/me");
    return serverMe;
  } catch {
    serverMe = null;
    return null;
  }
}

async function syncPaymentReturn() {
  if (paymentSyncPromise || location.protocol === "file:") return paymentSyncPromise;
  const params = new URLSearchParams(location.search);
  const outTradeNo = params.get("out_trade_no");
  const tradeNo = params.get("trade_no");
  if (!outTradeNo && !tradeNo) return null;
  const syncKey = `alipay-sync:${outTradeNo || tradeNo}`;
  if (sessionStorage.getItem(syncKey) === "done") return null;

  paymentSyncPromise = api("/api/payment/alipay/sync", {
    method: "POST",
    body: JSON.stringify({ outTradeNo, tradeNo }),
  })
    .then((data) => {
      serverMe = data;
      sessionStorage.setItem(syncKey, "done");
      const cleanUrl = `${location.origin}${location.pathname}${location.hash || "#/points"}`;
      history.replaceState(null, "", cleanUrl);
      toast("支付已确认，点数已到账。");
      return data;
    })
    .catch((error) => {
      toast(error.message);
      throw error;
    })
    .finally(() => {
      paymentSyncPromise = null;
    });
  return paymentSyncPromise;
}

function showFatal(error) {
  const app = document.querySelector("#app");
  if (!app) return;
  app.innerHTML = `
    <main class="main">
      <section class="section">
        <div class="card">
          <p class="eyebrow">启动失败</p>
          <h2>页面没消失，是脚本摔了</h2>
          <p class="notice">${String(error?.message || error).replace(/[<>&]/g, "")}</p>
        </div>
      </section>
    </main>
  `;
}

function showLoadingOverlay(title = "AI 正在出图") {
  hideLoadingOverlay();
  const node = document.createElement("div");
  node.className = "loading-overlay";
  node.innerHTML = `
    <div class="loading-panel" role="status" aria-live="polite">
      <button class="loader-close" type="button" aria-label="关闭等待动画">×</button>
      <div class="loader-stage">
        <div class="loader-orbit"></div>
        <div class="loader-spark one"></div>
        <div class="loader-spark two"></div>
        <div class="loader-spark three"></div>
        <div class="loader-line one"></div>
        <div class="loader-line two"></div>
        <div class="loader-line three"></div>
        <div class="loader-portrait"></div>
      </div>
      <div class="progress-shell"><div class="progress-bar"></div></div>
      <h2 class="loading-title">${title}</h2>
      <p class="loading-copy" id="loadingCopy">${loadingLines[0]}</p>
    </div>
  `;
  document.body.appendChild(node);
  node.querySelector(".loader-close").addEventListener("click", hideLoadingOverlay);
  let index = 0;
  loadingTimer = setInterval(() => {
    index = (index + 1) % loadingLines.length;
    const copy = document.querySelector("#loadingCopy");
    if (copy) copy.textContent = loadingLines[index];
  }, 2600);
}

function hideLoadingOverlay() {
  if (loadingTimer) clearInterval(loadingTimer);
  loadingTimer = null;
  document.querySelector(".loading-overlay")?.remove();
}

function requireLogin(message = "请先登录后再使用。") {
  if (serverMe?.user) return true;
  showLoginModal(message);
  return false;
}

function showLoginModal(message) {
  document.querySelector(".modal-backdrop")?.remove();
  const node = document.createElement("div");
  node.className = "modal-backdrop";
  node.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="loginModalTitle">
      <h2 id="loginModalTitle">请登录</h2>
      <p class="muted">${message}</p>
      <div class="actions">
        <button class="primary" id="modalLoginButton" type="button">登录 / 注册</button>
        <button class="plain" id="modalCloseButton" type="button">稍后</button>
      </div>
    </div>
  `;
  document.body.appendChild(node);
  node.querySelector("#modalLoginButton").addEventListener("click", () => {
    node.remove();
    location.hash = "#/login";
  });
  node.querySelector("#modalCloseButton").addEventListener("click", () => node.remove());
  node.addEventListener("click", (event) => {
    if (event.target === node) node.remove();
  });
}

function adSlot(id) {
  const slot = AD_SLOTS.find((item) => item.id === id) || AD_SLOTS[0];
  return `
    <aside class="ad-slot" data-ad-slot="${slot.id}">
      <span>广告位</span>
      <strong>${slot.label}</strong>
      <small>${slot.providers}</small>
    </aside>
  `;
}

function now() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function loadState() {
  const existing = storage.getItem(STORE_KEY);
  if (existing) {
    try {
      return JSON.parse(existing);
    } catch {
      storage.setItem(STORE_KEY, "");
    }
  }
  const userId = uid("anon");
  const fresh = {
    user: { id: userId, createdAt: now() },
    balance: 6,
    totalRecharged: 0,
    totalConsumed: 0,
    transactions: [
      { id: uid("txn"), type: "gift", points: 6, description: "新用户赠送 6 点", createdAt: now() },
    ],
    tasks: [],
    orders: [],
    events: [],
    lastTaskId: "",
  };
  storage.setItem(STORE_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveState() {
  storage.setItem(STORE_KEY, JSON.stringify(state));
}

function track(name, payload = {}) {
  state.events.unshift({ id: uid("evt"), name, payload, createdAt: now() });
  state.events = state.events.slice(0, 80);
  saveState();
}

function transact(type, points, description, related = {}) {
  state.transactions.unshift({ id: uid("txn"), type, points, description, createdAt: now(), ...related });
  if (type === "consume") {
    state.balance -= points;
    state.totalConsumed += points;
  }
  if (type === "recharge" || type === "gift" || type === "refund") {
    state.balance += points;
    if (type === "recharge") state.totalRecharged += points;
  }
  saveState();
}

function canSpend(points) {
  return displayBalance() >= points;
}

function spendOrRecharge(points, eventName) {
  if (canSpend(points)) {
    track(`${eventName}_point_enough`, { cost: points });
    return true;
  }
  track(`${eventName}_point_not_enough`, { cost: points, balance: state.balance });
  toast(`差 ${points - state.balance} 点。别硬撑，去充值。`);
  location.hash = "#/recharge";
  return false;
}

function canvasAvatar(seed, prompt, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const hue = Math.abs(hashCode(`${seed}${prompt}${options.style}`)) % 360;
  const accent = `hsl(${hue}, 72%, 54%)`;
  const bg = options.background === "白底" ? "#ffffff" : `hsl(${(hue + 42) % 360}, 52%, 88%)`;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = `hsl(${(hue + 190) % 360}, 70%, 88%)`;
  ctx.beginPath();
  ctx.arc(158, 176, 220, 0, Math.PI * 2);
  ctx.arc(900, 850, 280, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#151515";
  ctx.beginPath();
  ctx.ellipse(512, 485, 256, 286, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `hsl(${(hue + 25) % 360}, 62%, 74%)`;
  ctx.beginPath();
  ctx.ellipse(512, 518, 210, 244, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(512, 792, 310, 172, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#151515";
  ctx.beginPath();
  ctx.arc(438, 504, 18, 0, Math.PI * 2);
  ctx.arc(586, 504, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 14;
  ctx.strokeStyle = "#151515";
  ctx.beginPath();
  ctx.arc(512, 576, 78, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.fillText(options.style || "AI", 64, 914);
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillText((prompt || "专属头像").slice(0, 16), 64, 966);
  return canvas.toDataURL("image/png");
}

function hashCode(text) {
  return text.split("").reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function animatedSvgDataUrl(imageData, motion) {
  const label = motions.find((item) => item.id === motion)?.label || "动态头像";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f6f4ef"/>
  <image href="${imageData}" x="46" y="36" width="420" height="420">
    <animateTransform attributeName="transform" type="scale" values="1;1.035;1" dur="1.2s" repeatCount="indefinite"/>
  </image>
  <rect x="20" y="456" width="236" height="36" rx="18" fill="white" stroke="#151515"/>
  <text x="38" y="481" font-size="20" font-weight="700" fill="#151515">AI ${label}预览</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function layout(content) {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#/" data-track="click_home_logo">
          <span class="brand-mark">AI</span>
          <span>头像工厂 AI</span>
        </a>
        <nav class="nav">
          <span class="balance-pill">${serverMe?.user ? `余额 ${serverMe.balance} 点` : "未登录"}</span>
          <a href="#/text" data-track="click_text_avatar_entry">文字生成</a>
          <a href="#/motion" data-track="click_gif_avatar_entry">动态头像</a>
          <a href="#/points">我的点数</a>
          <a href="#/login">${serverMe?.user ? "账户" : "登录"}</a>
          <a href="#/recharge" data-track="click_recharge_entry">充值</a>
        </nav>
      </header>
      <main class="main">${content}</main>
      <footer class="footer">
        <a href="#/legal">用户协议</a> · <a href="#/legal">隐私政策</a> · <a href="#/legal">退款说明</a> · <a href="#/legal">投诉举报</a>
      </footer>
    </div>
  `;
  document.querySelectorAll("[data-track]").forEach((node) => {
    node.addEventListener("click", () => track(node.dataset.track));
  });
}

function displayBalance() {
  return serverMe?.user ? serverMe.balance : state.balance;
}

function homePage() {
  track("page_home_view");
  const examples = Array.from({ length: 6 }, (_, index) =>
    canvasAvatar(`example-${index}`, ["干净阳光", "赛博短发", "Q版女生", "商务头像", "情侣头像", "白底职业"][index], {
      style: styles[(index % 6) + 1],
      background: index % 2 ? "渐变" : "白底",
    }),
  );
  layout(`
    <section class="hero">
      <div>
        <p class="eyebrow">新用户送 6 点 · 生成 2 点起</p>
        <h1>一句话生成你的专属 AI 头像</h1>
        <p class="lead">文字生成静态头像，也能把上传头像做成轻动态预览。MVP 不装神弄鬼，目标只有一个：结果值不值得你付费下载。</p>
        <div class="actions">
          <a class="primary" href="#/text" data-track="click_text_avatar_entry">立即生成头像</a>
          <a class="ghost" href="#/motion" data-track="click_gif_avatar_entry">上传头像做动态</a>
        </div>
      </div>
      <div class="hero-board">
        ${examples.slice(0, 4).map((src) => `<div class="avatar-tile"><img alt="头像示例" src="${src}"></div>`).join("")}
      </div>
    </section>
    <section class="ad-band">${adSlot("home_mid")}</section>
    <section class="section grid three">
      <div class="card"><h3>静态头像</h3><p class="muted">2 点生成 2 张，预览免费下载，高清无水印 1 点。</p></div>
      <div class="card"><h3>动态头像</h3><p class="muted">上传头像，选眨眼、微笑、点头。8 点生成低清预览。</p></div>
      <div class="card"><h3>充值闭环</h3><p class="muted">点数包、订单、支付成功幂等到账，全链路已经跑通。</p></div>
    </section>
  `);
}

function textPage() {
  layout(`
    <section class="section grid two">
      <div>
        <p class="eyebrow">文字生成头像 · 消耗 ${COST.text} 点</p>
        <h2>把脑内画面压成一张能用的头像</h2>
        <p class="lead">少写玄学词，多写可见元素：人物、气质、衣服、背景、用途。</p>
      </div>
      <form class="card form" id="textForm">
        <div class="field">
          <label for="prompt">头像描述</label>
          <textarea id="prompt" required placeholder="一个穿蓝色衬衫的年轻男生，干净阳光，白色背景，适合微信头像。"></textarea>
        </div>
        ${segmentedField("风格", "style", styles, formState.style)}
        ${segmentedField("性别倾向", "gender", genders, formState.gender)}
        ${segmentedField("背景", "background", backgrounds, formState.background)}
        <button class="primary" type="submit">开始生成 · ${COST.text} 点</button>
      </form>
    </section>
    <section class="ad-band">${adSlot("tool_side")}</section>
  `);
  bindSegments();
  document.querySelector("#textForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = document.querySelector("#prompt").value.trim();
    if (!prompt) return toast("描述不能为空。空提示词生成的通常也是空价值。");
    if (location.protocol === "file:") {
      toast("真实生成需要后端。请用 http://127.0.0.1:4173 打开。");
      return;
    }
    if (!requireLogin("AI 生成需要账户，用来保存点数、订单和生成记录。")) return;
    track("generation_start", { type: "text_to_avatar" });
    if (!spendOrRecharge(COST.text, "generation")) return;
    const taskId = uid("task");
    const submitButton = event.submitter || document.querySelector("#textForm .primary");
    submitButton.disabled = true;
    submitButton.textContent = "AI 正在出图...";
    showLoadingOverlay("AI 正在出图");
    try {
      const outputs = await generateRealAvatars({
        prompt,
        style: formState.style,
        gender: formState.gender,
        background: formState.background,
      });
      serverMe = await refreshMe();
      state.tasks.unshift({
        id: taskId,
        type: "text_to_avatar",
        status: "success",
        prompt,
        style: formState.style,
        gender: formState.gender,
        background: formState.background,
        outputs,
        costPoints: COST.text,
        createdAt: now(),
        finishedAt: now(),
      });
      state.lastTaskId = taskId;
      saveState();
      track("generation_success", { taskId, type: "text_to_avatar" });
      hideLoadingOverlay();
      location.hash = `#/result/${taskId}`;
    } catch (error) {
      hideLoadingOverlay();
      serverMe = await refreshMe();
      track("generation_failed", { taskId, type: "text_to_avatar", error: error.message });
      toast(error.message);
      submitButton.disabled = false;
      submitButton.textContent = `开始生成 · ${COST.text} 点`;
    }
  });
}

async function generateRealAvatars(payload) {
  const response = await fetch("/api/generate/text-avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI 生成失败。");
  if (!Array.isArray(data.outputs) || data.outputs.length === 0) throw new Error("AI 没有返回头像。");
  return data.outputs;
}

function motionPage() {
  layout(`
    <section class="section grid two">
      <div>
        <p class="eyebrow">静态头像转动态 · 消耗 ${COST.gif} 点</p>
        <h2>先做轻动态，别让 GIF 支线掐死主线</h2>
        <p class="lead">MVP 用模板化动效模拟低清预览。真实上线时替换第三方动图接口。</p>
      </div>
      <form class="card form" id="motionForm">
        <div class="field">
          <label for="avatarFile">上传头像</label>
          <input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp" required />
          <p class="muted">支持 jpg / png / webp，≤ 10MB。</p>
        </div>
        ${segmentedField("动作模板", "motion", motions.map((m) => m.label), motions.find((m) => m.id === formState.motion).label)}
        <label class="notice">
          <input id="authorized" type="checkbox" ${formState.authorized ? "checked" : ""} />
          我确认已获得图片中人物的授权，并同意使用该图片生成 AI 动态头像。
        </label>
        <button class="primary" type="submit">生成动态头像 · ${COST.gif} 点</button>
      </form>
    </section>
    <section class="ad-band">${adSlot("tool_side")}</section>
  `);
  bindSegments();
  document.querySelector("#avatarFile").addEventListener("change", handleUpload);
  document.querySelector("#authorized").addEventListener("change", (event) => {
    formState.authorized = event.target.checked;
  });
  document.querySelector("#motionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireLogin("动态头像生成需要登录后使用。")) return;
    if (!formState.uploadData) return toast("先上传头像。没图就没有魔法。");
    if (!formState.authorized) return toast("授权确认必须勾选，这是底线，不是装饰。");
    track("generation_start", { type: "image_to_gif" });
    if (!spendOrRecharge(COST.gif, "generation")) return;
    const taskId = uid("task");
    transact("consume", COST.gif, "静态头像转动态预览", { relatedTaskId: taskId });
    const output = animatedSvgDataUrl(formState.uploadData, formState.motion);
    state.tasks.unshift({
      id: taskId,
      type: "image_to_gif",
      status: "success",
      motion: formState.motion,
      inputImageUrl: formState.uploadData,
      outputs: [output],
      costPoints: COST.gif,
      createdAt: now(),
      finishedAt: now(),
    });
    state.lastTaskId = taskId;
    saveState();
    track("generation_success", { taskId, type: "image_to_gif" });
    location.hash = `#/result/${taskId}`;
  });
}

function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const valid = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (!valid) return toast("格式不对。只收 jpg / png / webp。");
  if (file.size > 10 * 1024 * 1024) return toast("文件超过 10MB，先压缩。");
  const reader = new FileReader();
  reader.onload = () => {
    formState.uploadData = reader.result;
    toast("上传成功，可以生成动态头像。");
  };
  reader.readAsDataURL(file);
}

function segmentedField(label, key, values, active) {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="segmented" data-segment="${key}">
        ${values.map((value) => `<button class="chip ${value === active ? "active" : ""}" type="button" data-value="${value}">${value}</button>`).join("")}
      </div>
    </div>
  `;
}

function bindSegments() {
  document.querySelectorAll("[data-segment]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      const key = group.dataset.segment;
      if (key === "motion") {
        formState.motion = motions.find((m) => m.label === chip.dataset.value)?.id || "blink";
      } else {
        formState[key] = chip.dataset.value;
      }
      group.querySelectorAll(".chip").forEach((node) => node.classList.remove("active"));
      chip.classList.add("active");
    });
  });
}

function resultPage(taskId) {
  const task = state.tasks.find((item) => item.id === taskId) || state.tasks[0];
  if (!task) {
    layout(`<section class="section"><div class="card"><h2>还没有结果</h2><p class="muted">先生成一次，结果页才有东西。</p><a class="primary" href="#/text">去生成</a></div></section>`);
    return;
  }
  const isGif = task.type === "image_to_gif";
  layout(`
    <section class="section">
      <p class="eyebrow">生成成功 · 剩余 ${state.balance} 点</p>
      <h2>${isGif ? "动态头像预览" : "静态头像结果"}</h2>
      <p class="notice">本图片 / 动图由 AI 生成，仅供个人娱乐使用。</p>
      <div class="result-grid">
        ${task.outputs
          .map(
            (src, index) => `
          <article class="card">
            <div class="result-art watermark"><img class="${isGif ? `motion-preview ${task.motion}` : ""}" alt="生成结果" src="${src}"></div>
            <div class="actions">
              <button class="ghost" data-preview="${index}">${isGif ? "下载低清预览" : "下载预览图"}</button>
              <button class="primary" data-hd="${index}">高清下载 · ${isGif ? COST.gifHd : COST.textHd} 点</button>
            </div>
          </article>
        `,
          )
          .join("")}
      </div>
      <div class="actions">
        <button class="danger" id="regenerate">重新生成 · ${isGif ? COST.gif : COST.text} 点</button>
        <a class="ghost" href="#/recharge">去充值</a>
      </div>
      <div class="ad-band">${adSlot("result_bottom")}</div>
    </section>
  `);
  document.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.preview);
      track("click_preview_download", { taskId, index });
      downloadDataUrl(task.outputs[index], `${isGif ? "motion-preview" : "avatar-preview"}-${index + 1}.${isGif ? "svg" : "png"}`);
    });
  });
  document.querySelectorAll("[data-hd]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.hd);
      const cost = isGif ? COST.gifHd : COST.textHd;
      if (!requireLogin("高清下载需要登录后扣点。")) return;
      track("click_hd_download", { taskId, index, cost });
      if (!spendOrRecharge(cost, "hd_download")) return;
      transact("consume", cost, isGif ? "GIF 高清下载" : "高清无水印下载", { relatedTaskId: taskId });
      track("hd_download_success", { taskId, index });
      downloadDataUrl(task.outputs[index], `${isGif ? "motion-hd" : "avatar-hd"}-${index + 1}.${isGif ? "svg" : "png"}`);
      render();
    });
  });
  document.querySelector("#regenerate").addEventListener("click", async () => {
    track("click_regenerate", { taskId });
    if (isGif) {
      if (!requireLogin("重新生成需要登录后扣点。")) return;
      if (!spendOrRecharge(COST.gif, "generation")) return;
      const newTaskId = uid("task");
      transact("consume", COST.gif, "重新生成动态头像", { relatedTaskId: newTaskId });
      const output = animatedSvgDataUrl(task.inputImageUrl, task.motion);
      state.tasks.unshift({ ...task, id: newTaskId, outputs: [output], createdAt: now(), finishedAt: now() });
      state.lastTaskId = newTaskId;
      saveState();
      location.hash = `#/result/${newTaskId}`;
      return;
    }
    if (location.protocol === "file:") {
      toast("真实重新生成需要后端。请用 http://127.0.0.1:4173 打开。");
      return;
    }
    if (!requireLogin("重新生成需要登录后扣点。")) return;
    if (!spendOrRecharge(COST.text, "generation")) return;
    const newTaskId = uid("task");
    showLoadingOverlay("正在重新生成");
    try {
      const outputs = await generateRealAvatars({
        prompt: task.prompt,
        style: task.style,
        gender: task.gender,
        background: task.background,
      });
      serverMe = await refreshMe();
      state.tasks.unshift({ ...task, id: newTaskId, outputs, createdAt: now(), finishedAt: now() });
      state.lastTaskId = newTaskId;
      saveState();
      hideLoadingOverlay();
      location.hash = `#/result/${newTaskId}`;
    } catch (error) {
      hideLoadingOverlay();
      serverMe = await refreshMe();
      track("generation_failed", { taskId: newTaskId, type: "text_to_avatar", error: error.message });
      toast(error.message);
      render();
    }
  });
}

function rechargePage() {
  track("recharge_page_view");
  layout(`
    <section class="section">
      <p class="eyebrow">充值点数</p>
      <h2>点数可用于生成头像、动态头像和高清下载</h2>
      ${serverMe?.user ? "" : '<p class="notice">充值前需要登录手机号账户，点数会绑定到你的账户。</p>'}
      <div class="grid three">
        ${PACKAGES.map(
          (pkg) => `
          <article class="card">
            ${pkg.recommended ? '<span class="tag">推荐</span>' : ""}
            <h3>${pkg.name}</h3>
            <h2>${pkg.price}</h2>
            <p class="lead">${pkg.points} 点</p>
            <button class="primary" data-package="${pkg.id}">立即支付</button>
          </article>
        `,
        ).join("")}
      </div>
      <div class="ad-band">${adSlot("result_bottom")}</div>
      <p class="notice">点数到账后长期有效。虚拟商品支付成功后原则上不支持退款。生成失败不扣点，已扣点自动返还。</p>
    </section>
  `);
  document.querySelectorAll("[data-package]").forEach((button) => {
    button.addEventListener("click", async () => {
      const pkg = PACKAGES.find((item) => item.id === button.dataset.package);
      track("click_package", { packageId: pkg.id });
      if (serverMe?.user) {
        try {
          const data = await api("/api/payment/alipay/create", {
            method: "POST",
            body: JSON.stringify({ packageId: pkg.id }),
          });
          track("payment_start", { packageId: pkg.id, orderId: data.orderId });
          openPaymentForm(data.paymentForm);
        } catch (error) {
          if (error.message.includes("支付宝配置缺失")) {
            serverMe = await api("/api/payment/mock-pay", {
              method: "POST",
              body: JSON.stringify({ packageId: pkg.id }),
            });
            track("payment_success", { packageId: pkg.id });
            track("points_added", { packageId: pkg.id, points: pkg.points });
            toast(`${pkg.points} 点已到账。`);
            render();
          } else {
            toast(error.message);
          }
        }
        return;
      }
      requireLogin("充值前请先登录手机号账户。");
    });
  });
}

function openPaymentForm(html) {
  const win = window.open("", "_blank");
  if (!win) {
    toast("浏览器拦截了支付窗口，请允许弹窗后重试。");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function pointsPage() {
  const account = serverMe?.user ? serverMe : {
    user: null,
    balance: state.balance,
    totalRecharged: state.totalRecharged,
    totalConsumed: state.totalConsumed,
    transactions: state.transactions,
    orders: state.orders,
  };
  layout(`
    <section class="section grid two">
      <div class="card">
        <p class="eyebrow">我的点数</p>
        <h2>${account.balance} 点</h2>
        <p class="muted">累计充值 ${account.totalRecharged} 点，累计消耗 ${account.totalConsumed} 点。</p>
        <div class="actions"><a class="primary" href="${serverMe?.user ? "#/recharge" : "#/login"}">${serverMe?.user ? "充值" : "登录"}</a><a class="ghost" href="#/text">去生成</a></div>
      </div>
      <div class="card">
        <h3>${serverMe?.user ? "已登录账户" : "未登录"}</h3>
        <p class="muted">${serverMe?.user ? serverMe.user.phone : state.user.id}</p>
        <p class="notice">${serverMe?.user ? "当前账户、点数和流水来自服务端会话。" : "这是浏览器本地体验额度。付费前必须登录手机号账户。"}</p>
      </div>
    </section>
    <section class="section" style="margin-top: 22px">
      <h2>流水</h2>
      ${table(["类型", "点数", "说明", "时间"], account.transactions.map((txn) => [txn.type, txn.points, txn.description, formatTime(txn.createdAt)]))}
    </section>
    <section class="section" style="margin-top: 22px">
      <h2>订单</h2>
      ${table(["订单", "金额", "点数", "状态"], account.orders.map((order) => [order.id.slice(0, 18), `¥${(order.amount / 100).toFixed(1)}`, order.points, order.status]))}
    </section>
  `);
}

function table(headers, rows) {
  if (!rows.length) return `<p class="muted">暂无记录。</p>`;
  return `
    <table class="table">
      <thead><tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function legalPage() {
  layout(`
    <section class="section grid two">
      <div>
        <p class="eyebrow">协议与风控</p>
        <h2>该挡的挡，该退的退</h2>
      </div>
      <div class="card">
        <h3>禁止内容</h3>
        <p class="muted">色情裸露、暴力血腥、政治敏感、名人仿冒、未成年人不当内容、侵权 IP、诈骗赌博违法内容。</p>
        <h3>退款规则</h3>
        <p class="muted">充值后点数未使用、支付成功未到账、生成失败未返还可处理退款。点数已消耗、结果已生成、已下载高清内容原则上不退。</p>
        <h3>投诉入口</h3>
        <p class="muted">MVP 占位：support@example.com</p>
      </div>
    </section>
  `);
}

function loginPage() {
  layout(`
    <section class="auth-wrap">
      <div class="auth-card">
        <div class="auth-head">
          <span class="brand-mark">AI</span>
          <div>
            <p class="eyebrow">AI头像工厂</p>
            <h2>${authTitle()}</h2>
          </div>
        </div>
        ${serverMe?.user ? `<p class="notice">当前账户：${serverMe.user.phone}</p>` : ""}
        <div class="auth-tabs" id="authTabs">
          ${authTab("code", "验证码登录")}
          ${authTab("password", "密码登录")}
          ${authTab("set", "设置密码")}
        </div>
        ${authForm()}
        ${serverMe?.user ? `<button class="plain full" id="logoutButton" type="button">退出登录</button>` : ""}
        <p class="auth-foot">登录即代表同意 <a href="#/legal">用户协议</a> 和 <a href="#/legal">隐私政策</a></p>
      </div>
    </section>
  `);
  bindAuthForms();
}

function authTitle() {
  if (authMode === "password") return "密码登录";
  if (authMode === "set") return "设置登录密码";
  return "手机号登录";
}

function authTab(key, label) {
  return `<button class="${authMode === key ? "active" : ""}" type="button" data-auth-tab="${key}">${label}</button>`;
}

function authForm() {
  if (authMode === "password") {
    return `
      <form class="form auth-form" id="passwordLoginForm">
        <div class="field">
          <label for="passwordPhone">手机号</label>
          <input id="passwordPhone" inputmode="tel" placeholder="请输入手机号" required />
        </div>
        <div class="field">
          <label for="loginPassword">密码</label>
          <input id="loginPassword" type="password" placeholder="请输入密码" required />
        </div>
        <button class="primary full" type="submit">登录</button>
      </form>
    `;
  }
  if (authMode === "set") {
    return `
      <form class="form auth-form" id="setPasswordForm">
        <div class="field">
          <label for="setPhone">手机号</label>
          <input id="setPhone" inputmode="tel" placeholder="请输入手机号" required />
        </div>
        <div class="code-row">
          <div class="field">
            <label for="setCode">验证码</label>
            <input id="setCode" inputmode="numeric" placeholder="6 位验证码" required />
          </div>
          <button class="ghost code-button" type="button" id="sendSetCode">获取验证码</button>
        </div>
        <p class="notice compact" id="setCodeHint" hidden></p>
        <div class="field">
          <label for="newPassword">新密码</label>
          <input id="newPassword" type="password" placeholder="至少 8 位" required />
        </div>
        <button class="primary full" type="submit">设置并登录</button>
      </form>
    `;
  }
  return `
    <form class="form auth-form" id="codeLoginForm">
      <div class="field">
        <label for="codePhone">手机号</label>
        <input id="codePhone" inputmode="tel" placeholder="请输入手机号" required />
      </div>
      <div class="code-row">
        <div class="field">
          <label for="smsCode">验证码</label>
          <input id="smsCode" inputmode="numeric" placeholder="6 位验证码" required />
        </div>
        <button class="ghost code-button" type="button" id="sendLoginCode">获取验证码</button>
      </div>
      <p class="notice compact" id="loginCodeHint" hidden></p>
      <button class="primary full" type="submit">登录</button>
    </form>
  `;
}

function bindAuthForms() {
  document.querySelector("#authTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-tab]");
    if (!button) return;
    authMode = button.dataset.authTab;
    loginPage();
  });
  document.querySelector("#sendLoginCode")?.addEventListener("click", async () => {
    await requestSmsCode("#codePhone", "#loginCodeHint", "login");
  });
  document.querySelector("#sendSetCode")?.addEventListener("click", async () => {
    await requestSmsCode("#setPhone", "#setCodeHint", "set_password");
  });
  document.querySelector("#codeLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loginWithPayload("/api/auth/login-code", {
      phone: document.querySelector("#codePhone").value,
      code: document.querySelector("#smsCode").value,
    });
  });
  document.querySelector("#passwordLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loginWithPayload("/api/auth/login-password", {
      phone: document.querySelector("#passwordPhone").value,
      password: document.querySelector("#loginPassword").value,
    });
  });
  document.querySelector("#setPasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loginWithPayload("/api/auth/set-password", {
      phone: document.querySelector("#setPhone").value,
      code: document.querySelector("#setCode").value,
      password: document.querySelector("#newPassword").value,
    });
  });
  document.querySelector("#logoutButton")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    serverMe = await refreshMe();
    toast("已退出。");
    location.hash = "#/";
  });
}

async function requestSmsCode(phoneSelector, hintSelector, purpose) {
  try {
    const data = await api("/api/auth/code", {
      method: "POST",
      body: JSON.stringify({ phone: document.querySelector(phoneSelector).value, purpose }),
    });
    const hint = document.querySelector(hintSelector);
    hint.hidden = false;
    hint.textContent = data.devCode ? `本地 mock 验证码：${data.devCode}` : (data.message || "验证码已发送。");
  } catch (error) {
    toast(error.message);
  }
}

async function loginWithPayload(path, payload) {
  try {
    serverMe = await api(path, { method: "POST", body: JSON.stringify(payload) });
    toast("登录成功。账户和点数已经回到服务端。");
    location.hash = "#/points";
  } catch (error) {
    toast(error.message);
  }
}

function formatTime(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

async function render() {
  state = loadState();
  await refreshMe();
  if (location.search.includes("trade_no") || location.search.includes("out_trade_no")) {
    await syncPaymentReturn().catch(() => {});
  }
  const [route, arg] = location.hash.replace(/^#\//, "").split("/");
  if (!route) return homePage();
  if (route === "text") return textPage();
  if (route === "motion") return motionPage();
  if (route === "result") return resultPage(arg || state.lastTaskId);
  if (route === "recharge") return rechargePage();
  if (route === "points") return pointsPage();
  if (route === "login") return loginPage();
  if (route === "legal") return legalPage();
  if (route === "loading") {
    location.hash = "#/";
    return;
  }
  homePage();
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
