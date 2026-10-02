import { ALLOWED_FILES } from "./allowed-files.js";
import {
  createSessionToken,
  sanitizeParticipantName,
  secureStringEqual,
  verifySessionToken,
} from "./security.js";
import { createStoredZipStream } from "./zip.js";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const DOWNLOAD_TOKEN_LIFETIME_SECONDS = 60;
const CONSENT_VERSION = "2026-10-01-v1";

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...securityHeaders,
    },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

async function requireSession(request, env) {
  return verifySessionToken(bearerToken(request), env.SESSION_SECRET);
}

async function requireAdmin(request, env) {
  const session = await verifySessionToken(bearerToken(request), env.SESSION_SECRET);
  return session?.role === "admin" ? session : null;
}

async function listAllObjects(env, prefix) {
  const objects = [];
  let cursor;
  do {
    const result = await env.RECORDINGS_BUCKET.list({ prefix, cursor });
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

async function completedFiles(env, folder) {
  const prefix = `recordings/${folder}/`;
  const completed = (await listAllObjects(env, prefix))
    .map((object) => object.key.slice(prefix.length))
    .filter((filename) => ALLOWED_FILES.has(filename));
  return completed.sort();
}

async function createAdminSession(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return error("管理者画面の設定が完了していません。", 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return error("入力内容を確認してください。");
  }
  if (!(await secureStringEqual(body.password, env.ADMIN_PASSWORD))) {
    return error("管理者パスワードが正しくありません。", 403);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_LIFETIME_SECONDS;
  const token = await createSessionToken({
    sessionId: crypto.randomUUID(),
    folder: "__admin__",
    role: "admin",
    exp: expiresAt,
  }, env.SESSION_SECRET);
  return json({ token, expiresAt });
}

async function listParticipants(request, env) {
  if (!(await requireAdmin(request, env))) return error("管理者としてログインしてください。", 401);
  const objects = await listAllObjects(env, "recordings/");
  const profileKeys = objects.filter((object) => object.key.endsWith("/_profile.json"));
  const participants = await Promise.all(profileKeys.map(async ({ key }) => {
    const profileObject = await env.RECORDINGS_BUCKET.get(key);
    if (!profileObject) return null;
    const profile = await profileObject.json();
    const prefix = `recordings/${profile.folder}/`;
    const files = objects
      .map((object) => object.key.startsWith(prefix) ? object.key.slice(prefix.length) : "")
      .filter((filename) => ALLOWED_FILES.has(filename))
      .sort();
    return {
      sessionId: profile.sessionId,
      displayName: profile.displayName,
      folder: profile.folder,
      createdAt: profile.createdAt,
      files,
    };
  }));
  return json({
    participants: participants
      .filter(Boolean)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  });
}

function validRecordingFolder(folder) {
  return typeof folder === "string"
    && /^[^/]{1,80}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(folder);
}

async function getAdminRecording(request, env, url) {
  if (!(await requireAdmin(request, env))) return error("管理者としてログインしてください。", 401);
  const folder = url.searchParams.get("folder");
  const filename = url.searchParams.get("filename");
  if (!validRecordingFolder(folder) || !ALLOWED_FILES.has(filename)) {
    return error("録音ファイルの指定が正しくありません。", 400);
  }
  const object = await env.RECORDINGS_BUCKET.get(`recordings/${folder}/${filename}`);
  if (!object) return error("保存済みの録音が見つかりません。", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      ...securityHeaders,
    },
  });
}

async function createAdminDownloadToken(request, env) {
  if (!(await requireAdmin(request, env))) return error("管理者としてログインしてください。", 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return error("入力内容を確認してください。");
  }
  if (!validRecordingFolder(body.folder)) return error("参加者フォルダの指定が正しくありません。", 400);
  const profileObject = await env.RECORDINGS_BUCKET.get(`recordings/${body.folder}/_profile.json`);
  if (!profileObject) return error("参加者フォルダが見つかりません。", 404);

  const expiresAt = Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_LIFETIME_SECONDS;
  const token = await createSessionToken({
    sessionId: crypto.randomUUID(),
    folder: body.folder,
    role: "admin-download",
    exp: expiresAt,
  }, env.SESSION_SECRET);
  return json({ url: `/api/admin/download?token=${encodeURIComponent(token)}`, expiresAt });
}

function safeArchiveRoot(profile) {
  const name = String(profile.displayName || "recordings")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/gu, "-")
    .replace(/[. ]+$/u, "")
    .slice(0, 50) || "recordings";
  return `${name}-${String(profile.sessionId).slice(0, 8)}`;
}

async function downloadAdminFolder(request, env, url) {
  const session = await verifySessionToken(url.searchParams.get("token") || "", env.SESSION_SECRET);
  if (session?.role !== "admin-download" || !validRecordingFolder(session.folder)) {
    return error("ダウンロードリンクが無効か、有効期限が切れています。", 401);
  }

  const prefix = `recordings/${session.folder}/`;
  const objects = await listAllObjects(env, prefix);
  const included = objects.filter(({ key }) => {
    const filename = key.slice(prefix.length);
    return filename === "_profile.json" || ALLOWED_FILES.has(filename);
  });
  const profileObject = await env.RECORDINGS_BUCKET.get(`${prefix}_profile.json`);
  if (!profileObject) return error("参加者フォルダが見つかりません。", 404);
  const profile = await profileObject.json();
  const root = safeArchiveRoot(profile);
  const entries = included.map((object) => ({
    name: `${root}/${object.key.slice(prefix.length)}`,
    date: object.uploaded || profile.createdAt,
    getObject: () => env.RECORDINGS_BUCKET.get(object.key),
  }));

  return new Response(createStoredZipStream(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="recordings.zip"; filename*=UTF-8''${encodeURIComponent(`${root}.zip`)}`,
      "Cache-Control": "private, no-store",
      ...securityHeaders,
    },
  });
}

async function createSession(request, env) {
  if (!env.INVITE_CODE || !env.SESSION_SECRET) {
    return error("サイトの受付設定が完了していません。管理者に連絡してください。", 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error("入力内容を確認してください。");
  }

  if (!(await secureStringEqual(body.inviteCode, env.INVITE_CODE))) {
    return error("招待リンクが無効か、有効期限が切れています。", 403);
  }

  const participant = sanitizeParticipantName(body.name);
  if (!participant) return error("名前は40文字以内で入力してください。");

  const consent = body.consent || {};
  const requiredConsents = ["purpose", "voiceData", "safeContent"];
  if (!requiredConsents.every((key) => consent[key] === true)) {
    return error("すべての同意項目を確認してください。");
  }

  const sessionId = crypto.randomUUID();
  const folder = `${participant.folderName}/${sessionId}`;
  const createdAt = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const profile = {
    sessionId,
    displayName: participant.displayName,
    folder,
    createdAt,
    consentVersion: CONSENT_VERSION,
    consent: Object.fromEntries(requiredConsents.map((key) => [key, true])),
  };

  await env.RECORDINGS_BUCKET.put(
    `recordings/${folder}/_profile.json`,
    JSON.stringify(profile, null, 2),
    { httpMetadata: { contentType: "application/json; charset=utf-8" } },
  );

  const token = await createSessionToken({ sessionId, folder, exp: expiresAt }, env.SESSION_SECRET);
  return json({
    token,
    displayName: participant.displayName,
    folder,
    expiresAt,
    completed: [],
  }, 201);
}

async function getSessionStatus(request, env) {
  const session = await requireSession(request, env);
  if (!session) return error("セッションの有効期限が切れました。もう一度最初から開始してください。", 401);

  const profileObject = await env.RECORDINGS_BUCKET.get(`recordings/${session.folder}/_profile.json`);
  if (!profileObject) return error("録音セッションが見つかりません。", 404);
  const profile = await profileObject.json();
  return json({
    displayName: profile.displayName,
    folder: session.folder,
    expiresAt: session.exp,
    completed: await completedFiles(env, session.folder),
  });
}

function looksLikeWav(bytes) {
  if (bytes.byteLength < 44) return false;
  const view = new Uint8Array(bytes, 0, 12);
  return String.fromCharCode(...view.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...view.slice(8, 12)) === "WAVE";
}

async function uploadRecording(request, env, filename) {
  const session = await requireSession(request, env);
  if (!session) return error("セッションの有効期限が切れました。もう一度最初から開始してください。", 401);
  if (!ALLOWED_FILES.has(filename)) return error("このファイル名は録音対象に含まれていません。", 404);
  if (request.headers.get("Content-Type")?.split(";", 1)[0] !== "audio/wav") {
    return error("WAV形式の音声だけ保存できます。", 415);
  }

  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize > MAX_UPLOAD_BYTES) return error("録音ファイルが大きすぎます。", 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return error("録音ファイルの容量を確認してください。", 413);
  }
  if (!looksLikeWav(bytes)) return error("WAVファイルを確認できませんでした。", 415);

  await env.RECORDINGS_BUCKET.put(`recordings/${session.folder}/${filename}`, bytes, {
    httpMetadata: { contentType: "audio/wav" },
    customMetadata: {
      sessionId: session.sessionId,
      uploadedAt: new Date().toISOString(),
    },
  });
  return json({ ok: true, filename });
}

async function downloadRecording(request, env, filename) {
  const session = await requireSession(request, env);
  if (!session) return error("セッションの有効期限が切れました。もう一度最初から開始してください。", 401);
  if (!ALLOWED_FILES.has(filename)) return error("このファイル名は録音対象に含まれていません。", 404);

  const object = await env.RECORDINGS_BUCKET.get(`recordings/${session.folder}/${filename}`);
  if (!object) return error("保存済みの録音が見つかりません。", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      ...securityHeaders,
    },
  });
}

async function handleApi(request, env, url) {
  if (url.pathname === "/api/admin/session" && request.method === "POST") return createAdminSession(request, env);
  if (url.pathname === "/api/admin/participants" && request.method === "GET") return listParticipants(request, env);
  if (url.pathname === "/api/admin/recording" && request.method === "GET") return getAdminRecording(request, env, url);
  if (url.pathname === "/api/admin/download-token" && request.method === "POST") return createAdminDownloadToken(request, env);
  if (url.pathname === "/api/admin/download" && request.method === "GET") return downloadAdminFolder(request, env, url);
  if (url.pathname === "/api/session" && request.method === "POST") return createSession(request, env);
  if (url.pathname === "/api/session" && request.method === "GET") return getSessionStatus(request, env);

  const uploadMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)$/u);
  if (uploadMatch && request.method === "PUT") {
    return uploadRecording(request, env, decodeURIComponent(uploadMatch[1]));
  }
  if (uploadMatch && request.method === "GET") {
    return downloadRecording(request, env, decodeURIComponent(uploadMatch[1]));
  }
  return error("ページが見つかりません。", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
      if (url.pathname === "/" || url.pathname.endsWith(".html")) headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (cause) {
      console.error("Request failed", cause);
      return error("一時的な問題が発生しました。少し待ってからもう一度お試しください。", 500);
    }
  },
};
