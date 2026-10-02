const elements = {
  login: document.querySelector("#admin-login"),
  loginForm: document.querySelector("#admin-login-form"),
  loginError: document.querySelector("#login-error"),
  dashboard: document.querySelector("#admin-dashboard"),
  participantCount: document.querySelector("#participant-count"),
  recordingCount: document.querySelector("#recording-count"),
  completeCount: document.querySelector("#complete-count"),
  search: document.querySelector("#participant-search"),
  status: document.querySelector("#dashboard-status"),
  list: document.querySelector("#participant-list"),
  empty: document.querySelector("#empty-state"),
  refreshButton: document.querySelector("#refresh-button"),
  logoutButton: document.querySelector("#logout-button"),
  toast: document.querySelector("#admin-toast"),
};

let token = sessionStorage.getItem("voice-recording-admin-session") || "";
let participants = [];
let activeAudioUrl = "";

function showToast(message, kind = "info") {
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

async function adminApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "通信に失敗しました。");
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function stopCurrentAudio() {
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = "";
  document.querySelectorAll("audio").forEach((audio) => {
    audio.pause();
    audio.removeAttribute("src");
    audio.hidden = true;
  });
}

function createParticipantCard(participant) {
  const article = document.createElement("article");
  article.className = "participant-card";
  article.dataset.search = participant.displayName.normalize("NFKC").toLowerCase();

  const top = document.createElement("div");
  top.className = "participant-top";
  const identity = document.createElement("div");
  const name = document.createElement("h2");
  name.textContent = participant.displayName;
  const date = document.createElement("p");
  date.textContent = `開始: ${formatDate(participant.createdAt)}`;
  identity.append(name, date);

  const count = document.createElement("div");
  count.className = participant.files.length === 100 ? "completion-count complete" : "completion-count";
  count.innerHTML = `<strong>${participant.files.length}</strong><span>/ 100</span>`;
  top.append(identity, count);

  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = participant.files.length;
  progress.setAttribute("aria-label", `${participant.displayName}さんの録音進捗`);

  const player = document.createElement("div");
  player.className = "participant-player";
  if (participant.files.length) {
    const label = document.createElement("label");
    label.textContent = "試聴する音声";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `${participant.displayName}さんの音声を選ぶ`);
    for (const filename of participant.files) {
      const option = document.createElement("option");
      option.value = filename;
      option.textContent = filename;
      select.append(option);
    }
    const playButton = document.createElement("button");
    playButton.className = "play-button";
    playButton.type = "button";
    playButton.textContent = "読み込んで試聴";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.hidden = true;
    playButton.addEventListener("click", async () => {
      playButton.disabled = true;
      playButton.textContent = "読み込んでいます…";
      try {
        stopCurrentAudio();
        const params = new URLSearchParams({ folder: participant.folder, filename: select.value });
        const response = await fetch(`/api/admin/recording?${params}`, {
          headers: { "Authorization": `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "音声を読み込めませんでした。");
        }
        activeAudioUrl = URL.createObjectURL(await response.blob());
        audio.src = activeAudioUrl;
        audio.hidden = false;
        await audio.play().catch(() => {});
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        playButton.disabled = false;
        playButton.textContent = "読み込んで試聴";
      }
    });
    select.addEventListener("change", stopCurrentAudio);
    const downloadButton = document.createElement("button");
    downloadButton.className = "download-button";
    downloadButton.type = "button";
    downloadButton.textContent = "ZIPでダウンロード";
    downloadButton.addEventListener("click", async () => {
      downloadButton.disabled = true;
      downloadButton.textContent = "準備しています…";
      try {
        const result = await adminApi("/api/admin/download-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: participant.folder }),
        });
        const link = document.createElement("a");
        link.href = result.url;
        link.download = "";
        document.body.append(link);
        link.click();
        link.remove();
        showToast(`${participant.displayName}さんのZIPダウンロードを開始しました`, "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        downloadButton.disabled = false;
        downloadButton.textContent = "ZIPでダウンロード";
      }
    });
    player.append(label, select, playButton, downloadButton, audio);
  } else {
    const noAudio = document.createElement("p");
    noAudio.className = "no-audio";
    noAudio.textContent = "まだ保存された音声はありません。";
    player.append(noAudio);
  }

  article.append(top, progress, player);
  return article;
}

function renderParticipants() {
  stopCurrentAudio();
  const query = elements.search.value.normalize("NFKC").trim().toLowerCase();
  const visible = participants.filter((participant) => participant.displayName.normalize("NFKC").toLowerCase().includes(query));
  elements.list.replaceChildren(...visible.map(createParticipantCard));
  elements.empty.hidden = visible.length !== 0;
  elements.status.textContent = query ? `${visible.length}人が一致しました` : `${participants.length}人を表示しています`;
}

async function loadParticipants() {
  elements.refreshButton.disabled = true;
  elements.status.textContent = "データを読み込んでいます…";
  try {
    const result = await adminApi("/api/admin/participants");
    participants = result.participants;
    elements.participantCount.textContent = String(participants.length);
    elements.recordingCount.textContent = String(participants.reduce((sum, participant) => sum + participant.files.length, 0));
    elements.completeCount.textContent = String(participants.filter((participant) => participant.files.length === 100).length);
    renderParticipants();
  } catch (error) {
    if (error.status === 401) {
      logout();
      return;
    }
    elements.status.textContent = "データを読み込めませんでした。";
    showToast(error.message, "error");
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function enterDashboard() {
  elements.login.hidden = true;
  elements.dashboard.hidden = false;
  loadParticipants();
}

function logout() {
  stopCurrentAudio();
  token = "";
  participants = [];
  sessionStorage.removeItem("voice-recording-admin-session");
  elements.dashboard.hidden = true;
  elements.login.hidden = false;
  elements.loginForm.reset();
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";
  const submitButton = elements.loginForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  try {
    const result = await adminApi("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: new FormData(elements.loginForm).get("password") }),
    });
    token = result.token;
    sessionStorage.setItem("voice-recording-admin-session", token);
    enterDashboard();
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

elements.search.addEventListener("input", renderParticipants);
elements.refreshButton.addEventListener("click", loadParticipants);
elements.logoutButton.addEventListener("click", logout);

if (token) enterDashboard();
