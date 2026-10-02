import { recordedBlobToWav } from "./wav.js";

const elements = {
  setup: document.querySelector("#setup"),
  setupForm: document.querySelector("#setup-form"),
  setupError: document.querySelector("#setup-error"),
  workspace: document.querySelector("#workspace"),
  participantName: document.querySelector("#participant-name"),
  progressText: document.querySelector("#progress-text"),
  progressBar: document.querySelector("#progress-bar"),
  itemCounter: document.querySelector("#item-counter"),
  jumpSelect: document.querySelector("#prompt-jump"),
  filename: document.querySelector("#filename"),
  promptText: document.querySelector("#prompt-text"),
  status: document.querySelector("#recording-status"),
  timer: document.querySelector("#timer"),
  recordButton: document.querySelector("#record-button"),
  stopButton: document.querySelector("#stop-button"),
  listenSavedButton: document.querySelector("#listen-saved-button"),
  playback: document.querySelector("#playback"),
  reviewActions: document.querySelector("#review-actions"),
  retakeButton: document.querySelector("#retake-button"),
  saveButton: document.querySelector("#save-button"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  savedBadge: document.querySelector("#saved-badge"),
  completePanel: document.querySelector("#complete-panel"),
  toast: document.querySelector("#toast"),
};

let prompts = [];
let currentIndex = 0;
let session = null;
let inviteCode = "";
let recorder = null;
let stream = null;
let chunks = [];
let previewBlob = null;
let previewUrl = "";
let previewKind = null;
let startedAt = 0;
let recordingDuration = 0;
let timerHandle = 0;

function showToast(message, kind = "info") {
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "通信に失敗しました。");
  return data;
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateProgress() {
  const count = session?.completed.size || 0;
  elements.progressText.textContent = `${count} / ${prompts.length} 完了`;
  elements.progressBar.value = count;
  elements.progressBar.max = prompts.length;
  elements.completePanel.hidden = count !== prompts.length;
}

function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  previewBlob = null;
  previewKind = null;
  elements.playback.removeAttribute("src");
  elements.playback.hidden = true;
  elements.reviewActions.hidden = true;
  elements.recordButton.disabled = false;
  elements.status.textContent = "録音の準備ができています";
}

function renderPrompt() {
  const prompt = prompts[currentIndex];
  const isSaved = session.completed.has(prompt.filename);
  clearPreview();
  elements.timer.textContent = "00:00";
  elements.itemCounter.textContent = `${currentIndex + 1} / ${prompts.length}`;
  elements.jumpSelect.value = String(currentIndex);
  elements.filename.textContent = prompt.filename;
  elements.promptText.textContent = prompt.text;
  elements.savedBadge.hidden = !isSaved;
  elements.listenSavedButton.hidden = !isSaved;
  elements.previousButton.disabled = currentIndex === 0;
  elements.nextButton.disabled = currentIndex === prompts.length - 1;
  elements.status.textContent = isSaved ? "保存済みです。録り直す場合は録音を始めてください" : "録音の準備ができています";
  updateProgress();
}

function enterWorkspace() {
  elements.participantName.textContent = session.displayName;
  elements.setup.hidden = true;
  elements.workspace.hidden = false;
  const firstIncomplete = prompts.findIndex((prompt) => !session.completed.has(prompt.filename));
  currentIndex = firstIncomplete === -1 ? 0 : firstIncomplete;
  renderPrompt();
}

function stopStream() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("このブラウザは録音に対応していません。最新版のChromeまたはSafariをお試しください。", "error");
    return;
  }
  try {
    clearPreview();
    elements.listenSavedButton.hidden = true;
    elements.timer.textContent = "00:00";
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", processRecording, { once: true });
    recorder.start(250);
    startedAt = performance.now();
    recordingDuration = 0;
    elements.recordButton.disabled = true;
    elements.stopButton.disabled = false;
    elements.status.textContent = "録音中です";
    elements.status.dataset.active = "true";
    timerHandle = window.setInterval(() => {
      elements.timer.textContent = formatTime(performance.now() - startedAt);
    }, 200);
  } catch (error) {
    stopStream();
    showToast(error.name === "NotAllowedError" ? "マイクの使用を許可してください。" : "録音を開始できませんでした。", "error");
  }
}

function stopTimer() {
  if (timerHandle) window.clearInterval(timerHandle);
  timerHandle = 0;
  recordingDuration = Math.max(0, performance.now() - startedAt);
  elements.timer.textContent = formatTime(recordingDuration);
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
  stopTimer();
  elements.stopButton.disabled = true;
  elements.status.textContent = "音声をWAVに変換しています…";
  delete elements.status.dataset.active;
}

async function processRecording() {
  const rawBlob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
  recorder = null;
  stopStream();
  if (recordingDuration < 350 || rawBlob.size === 0) {
    elements.timer.textContent = "00:00";
    elements.recordButton.disabled = false;
    elements.status.textContent = "録音が短すぎます。もう一度お試しください";
    return;
  }
  try {
    previewBlob = await recordedBlobToWav(rawBlob);
    previewKind = "draft";
    previewUrl = URL.createObjectURL(previewBlob);
    elements.playback.src = previewUrl;
    elements.playback.hidden = false;
    elements.reviewActions.hidden = false;
    elements.status.textContent = "再生して内容を確認してください";
  } catch (error) {
    console.error(error);
    elements.recordButton.disabled = false;
    elements.status.textContent = "音声を変換できませんでした";
    showToast("音声の変換に失敗しました。ブラウザを更新してお試しください。", "error");
  }
}

async function saveRecording() {
  if (!previewBlob || previewKind !== "draft") return;
  const prompt = prompts[currentIndex];
  elements.saveButton.disabled = true;
  elements.retakeButton.disabled = true;
  elements.status.textContent = `${prompt.filename} を保存しています…`;
  try {
    await api(`/api/recordings/${encodeURIComponent(prompt.filename)}`, {
      method: "PUT",
      headers: { "Content-Type": "audio/wav" },
      body: previewBlob,
    });
    session.completed.add(prompt.filename);
    showToast(`${prompt.filename} を保存しました`, "success");
    const nextIncomplete = prompts.findIndex((item, index) => index > currentIndex && !session.completed.has(item.filename));
    if (nextIncomplete !== -1) currentIndex = nextIncomplete;
    renderPrompt();
  } catch (error) {
    elements.status.textContent = "保存できませんでした。音声はこの画面に残っています";
    showToast(error.message, "error");
  } finally {
    elements.saveButton.disabled = false;
    elements.retakeButton.disabled = false;
  }
}

function navigate(direction) {
  if (previewKind === "draft") {
    showToast("先に録音を保存するか、録り直しを選んでください。", "error");
    return;
  }
  currentIndex = Math.max(0, Math.min(prompts.length - 1, currentIndex + direction));
  renderPrompt();
}

async function listenToSavedRecording() {
  const prompt = prompts[currentIndex];
  elements.listenSavedButton.disabled = true;
  elements.listenSavedButton.textContent = "読み込んでいます…";
  try {
    const response = await fetch(`/api/recordings/${encodeURIComponent(prompt.filename)}`, {
      headers: { "Authorization": `Bearer ${session.token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "保存済み音声を読み込めませんでした。");
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(await response.blob());
    previewKind = "saved";
    previewBlob = null;
    elements.playback.src = previewUrl;
    elements.playback.hidden = false;
    elements.status.textContent = "保存済み音声を再生できます。録り直す場合は「録音する」を押してください";
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.listenSavedButton.disabled = false;
    elements.listenSavedButton.textContent = "保存済み音声を試聴";
  }
}

async function restoreSession() {
  const token = sessionStorage.getItem("voice-recording-session");
  if (!token) return false;
  session = { token };
  try {
    const result = await api("/api/session");
    session = { ...result, token, completed: new Set(result.completed) };
    enterWorkspace();
    return true;
  } catch {
    sessionStorage.removeItem("voice-recording-session");
    session = null;
    return false;
  }
}

async function initialize() {
  try {
    prompts = await fetch("/prompts.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error();
      return response.json();
    });
    elements.progressBar.max = prompts.length;
    for (const [index, prompt] of prompts.entries()) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${prompt.filename.replace(".wav", "")} — ${prompt.text}`;
      elements.jumpSelect.append(option);
    }
  } catch {
    elements.setupError.textContent = "文章データを読み込めませんでした。ページを更新してください。";
    return;
  }

  const url = new URL(window.location.href);
  inviteCode = url.searchParams.get("invite") || "";
  if (inviteCode) {
    url.searchParams.delete("invite");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (await restoreSession()) return;
  if (!inviteCode) {
    elements.setupForm.querySelector("button[type=submit]").disabled = true;
  }
}

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.setupError.textContent = "";
  const form = new FormData(elements.setupForm);
  const submitButton = elements.setupForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "準備しています…";
  try {
    const result = await api("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteCode,
        name: form.get("name"),
        consent: {
          purpose: form.get("purpose") === "on",
          voiceData: form.get("voiceData") === "on",
          safeContent: form.get("safeContent") === "on",
        },
      }),
    });
    session = { ...result, completed: new Set(result.completed) };
    sessionStorage.setItem("voice-recording-session", session.token);
    enterWorkspace();
  } catch (error) {
    elements.setupError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "録音を始める";
  }
});

elements.recordButton.addEventListener("click", startRecording);
elements.stopButton.addEventListener("click", stopRecording);
elements.listenSavedButton.addEventListener("click", listenToSavedRecording);
elements.retakeButton.addEventListener("click", () => {
  renderPrompt();
});
elements.saveButton.addEventListener("click", saveRecording);
elements.previousButton.addEventListener("click", () => navigate(-1));
elements.nextButton.addEventListener("click", () => navigate(1));
elements.jumpSelect.addEventListener("change", () => {
  if (previewKind === "draft") {
    elements.jumpSelect.value = String(currentIndex);
    showToast("先に録音を保存するか、録り直しを選んでください。", "error");
    return;
  }
  currentIndex = Number(elements.jumpSelect.value);
  renderPrompt();
});
window.addEventListener("beforeunload", (event) => {
  if (recorder?.state === "recording" || previewBlob) {
    event.preventDefault();
    event.returnValue = "";
  }
});

initialize();
