import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULTS = {
  enabled: true,
  baseUrl: "http://127.0.0.1:3000",
  requestTimeoutSec: 20,
  autoStartOnHealthCheck: false,
  startupWaitSec: 40,
};

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function asNumber(value, fallback, min, max) {
  const num = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(num)));
}

function ensureHttpBase(input) {
  const base = asString(input, DEFAULTS.baseUrl).replace(/\/+$/, "");
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return base;
  }
  return DEFAULTS.baseUrl;
}

function loadConfig(raw) {
  const cfg = asObject(raw);
  const home = os.homedir();
  const defaultOpenRoomDir = path.join(home, "claw", "OpenRoom");
  const defaultDevCommand = `pnpm --dir ${defaultOpenRoomDir} dev`;
  const defaultLogFile = path.join(home, ".openclaw", "logs", "openroom-dev.log");
  const defaultPidFile = path.join(home, ".openclaw", "openroom-dev.pid");

  return {
    enabled: asBoolean(cfg.enabled, DEFAULTS.enabled),
    baseUrl: ensureHttpBase(asString(cfg.baseUrl, DEFAULTS.baseUrl)),
    requestTimeoutSec: asNumber(cfg.requestTimeoutSec, DEFAULTS.requestTimeoutSec, 2, 120),
    openRoomDir: asString(cfg.openRoomDir, defaultOpenRoomDir),
    devCommand: asString(cfg.devCommand, defaultDevCommand),
    logFile: asString(cfg.logFile, defaultLogFile),
    pidFile: asString(cfg.pidFile, defaultPidFile),
    autoStartOnHealthCheck: asBoolean(cfg.autoStartOnHealthCheck, DEFAULTS.autoStartOnHealthCheck),
    startupWaitSec: asNumber(cfg.startupWaitSec, DEFAULTS.startupWaitSec, 5, 180),
  };
}

function normalizeText(text) {
  if (!text) {
    return "";
  }
  return String(text).replace(/\r\n/g, "\n").trim();
}

function toJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toolSuccess(payload) {
  return {
    content: [{ type: "text", text: toJsonText(payload) }],
    details: payload,
  };
}

function toolError(message, details = {}) {
  return {
    content: [{ type: "text", text: toJsonText({ ok: false, error: message, ...details }) }],
    details: { ok: false, error: message, ...details },
    isError: true,
  };
}

async function readPid(pidFile) {
  try {
    const raw = normalizeText(await fs.readFile(pidFile, "utf8"));
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

async function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureParent(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function startDevServer(cfg) {
  const existingPid = await readPid(cfg.pidFile);
  if (existingPid && (await isPidAlive(existingPid))) {
    return { ok: true, alreadyRunning: true, pid: existingPid, command: cfg.devCommand };
  }

  await ensureParent(cfg.logFile);
  await ensureParent(cfg.pidFile);

  const logFd = await fs.open(cfg.logFile, "a");

  const child = spawn("bash", ["-lc", cfg.devCommand], {
    cwd: cfg.openRoomDir,
    detached: true,
    stdio: ["ignore", logFd.fd, logFd.fd],
    env: process.env,
  });

  child.unref();
  await fs.writeFile(cfg.pidFile, `${child.pid}\n`, "utf8");
  await logFd.close();

  return { ok: true, alreadyRunning: false, pid: child.pid, command: cfg.devCommand };
}

async function stopDevServer(cfg) {
  const pid = await readPid(cfg.pidFile);
  if (!pid) {
    return { ok: true, stopped: false, reason: "pid_not_found" };
  }

  let killed = false;
  try {
    process.kill(pid, "SIGTERM");
    killed = true;
  } catch {
    killed = false;
  }

  try {
    await fs.rm(cfg.pidFile, { force: true });
  } catch {
    // no-op
  }

  return { ok: true, stopped: killed, pid };
}

async function waitForHealthy(cfg, maxSeconds) {
  const deadline = Date.now() + maxSeconds * 1000;
  let lastError = "unknown";

  while (Date.now() <= deadline) {
    const probe = await probeHealth(cfg);
    if (probe.ok) {
      return probe;
    }
    lastError = probe.error || "unreachable";
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { ok: false, error: `openroom not healthy within ${maxSeconds}s (${lastError})` };
}

async function fetchEndpoint(cfg, endpoint, options = {}) {
  const controller = new AbortController();
  const timeoutMs = cfg.requestTimeoutSec * 1000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const method = asString(options.method, "GET");
  const headers = asObject(options.headers);

  const reqHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") {
      reqHeaders[k] = v;
    }
  }

  let body = options.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    if (!reqHeaders["content-type"]) {
      reqHeaders["content-type"] = "application/json";
    }
    body = JSON.stringify(body);
  }

  const url = `${cfg.baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: reqHeaders,
      body,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let text = "";
    if (contentType.includes("application/json") || contentType.includes("text/") || contentType.includes("javascript")) {
      text = new TextDecoder().decode(bytes);
    }

    const json = text ? safeParseJson(text) : null;

    return {
      ok: response.ok,
      status: response.status,
      url,
      contentType,
      bytes: bytes.length,
      text: normalizeText(text),
      json,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, status: 0, url, error: `timeout after ${cfg.requestTimeoutSec}s` };
    }
    return { ok: false, status: 0, url, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeHealth(cfg) {
  const ping = await fetchEndpoint(cfg, "/api/llm-config", { method: "GET" });
  if (!ping.ok) {
    return {
      ok: false,
      baseUrl: cfg.baseUrl,
      error: ping.error || `http_${ping.status}`,
      status: ping.status,
    };
  }

  return {
    ok: true,
    baseUrl: cfg.baseUrl,
    status: ping.status,
    hasJson: !!ping.json,
  };
}

function resolveJsonPayload(value, keyName) {
  if (typeof value === "string") {
    const parsed = safeParseJson(value);
    if (parsed === null) {
      throw new Error(`${keyName} string must be valid JSON`);
    }
    return parsed;
  }

  if (value && typeof value === "object") {
    return value;
  }

  throw new Error(`${keyName} is required (object or JSON string)`);
}

function encodeQuery(params) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) {
      continue;
    }
    query.set(k, String(v));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function buildSessionPathParams(params) {
  const p = asObject(params);
  const relPath = asString(p.path, "");
  if (!relPath) {
    throw new Error("path is required");
  }
  return relPath;
}

function buildSimpleTool(name, description, parameters, fn, logger, cfg) {
  return {
    name,
    label: name,
    description,
    parameters,
    async execute(_toolCallId, params) {
      try {
        const result = await fn(params, cfg);
        return toolSuccess(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        logger.error(`[openroom-bridge] ${name} failed: ${message}`);
        return toolError(message, { tool: name });
      }
    },
  };
}

function healthToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_health",
    "Check OpenRoom bridge health, optionally auto-start dev server",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        autoStart: { type: "boolean" },
      },
    },
    async (params) => {
      const p = asObject(params);
      const autoStart = asBoolean(p.autoStart, cfg.autoStartOnHealthCheck);
      const initial = await probeHealth(cfg);
      if (initial.ok) {
        const pid = await readPid(cfg.pidFile);
        return {
          ok: true,
          healthy: true,
          baseUrl: cfg.baseUrl,
          pid: pid || null,
          autoStarted: false,
        };
      }

      if (!autoStart) {
        return {
          ok: false,
          healthy: false,
          baseUrl: cfg.baseUrl,
          error: initial.error || "unreachable",
          hint: "Run openroom_dev_start or /openroom_up",
        };
      }

      const started = await startDevServer(cfg);
      const waited = await waitForHealthy(cfg, cfg.startupWaitSec);

      return {
        ok: waited.ok,
        healthy: waited.ok,
        baseUrl: cfg.baseUrl,
        autoStarted: true,
        started,
        probe: waited,
      };
    },
    logger,
    cfg,
  );
}

function startToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_dev_start",
    "Start OpenRoom dev server in background",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string" },
        workdir: { type: "string" },
        waitHealthy: { type: "boolean" },
      },
    },
    async (params) => {
      const p = asObject(params);
      const nextCfg = {
        ...cfg,
        devCommand: asString(p.command, cfg.devCommand),
        openRoomDir: asString(p.workdir, cfg.openRoomDir),
      };

      const started = await startDevServer(nextCfg);
      const waitHealthy = asBoolean(p.waitHealthy, true);
      if (!waitHealthy) {
        return { ok: true, started, waited: null };
      }
      const probe = await waitForHealthy(nextCfg, nextCfg.startupWaitSec);
      return { ok: probe.ok, started, probe, logFile: nextCfg.logFile };
    },
    logger,
    cfg,
  );
}

function stopToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_dev_stop",
    "Stop OpenRoom dev server started by bridge",
    {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async () => stopDevServer(cfg),
    logger,
    cfg,
  );
}

function llmConfigGetToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_llm_config_get",
    "Get OpenRoom LLM config from /api/llm-config",
    {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async () => {
      const result = await fetchEndpoint(cfg, "/api/llm-config", { method: "GET" });
      if (!result.ok) {
        throw new Error(result.error || `http_${result.status}`);
      }
      return {
        ok: true,
        status: result.status,
        config: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

function llmConfigSetToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_llm_config_set",
    "Write OpenRoom LLM config to /api/llm-config",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        config: {
          description: "Config object or JSON string",
        },
      },
      required: ["config"],
    },
    async (params) => {
      const payload = resolveJsonPayload(asObject(params).config, "config");
      const result = await fetchEndpoint(cfg, "/api/llm-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }
      return { ok: true, status: result.status, response: result.json ?? result.text };
    },
    logger,
    cfg,
  );
}

function sessionReadToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_session_read",
    "Read OpenRoom session file by path",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    async (params) => {
      const relPath = buildSessionPathParams(params);
      const endpoint = `/api/session-data${encodeQuery({ path: relPath })}`;
      const result = await fetchEndpoint(cfg, endpoint, { method: "GET" });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }

      const binary = !result.text && result.bytes > 0;
      return {
        ok: true,
        status: result.status,
        path: relPath,
        contentType: result.contentType,
        bytes: result.bytes,
        isBinary: binary,
        content: binary ? null : (result.json ?? result.text),
      };
    },
    logger,
    cfg,
  );
}

function sessionWriteToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_session_write",
    "Write OpenRoom session file by path",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        content: { description: "String/object payload" },
        contentType: { type: "string" },
      },
      required: ["path", "content"],
    },
    async (params) => {
      const p = asObject(params);
      const relPath = buildSessionPathParams(p);
      const ct = asString(p.contentType, "application/json");
      let payload = p.content;

      if (ct.includes("application/json")) {
        if (typeof payload === "string") {
          const parsed = safeParseJson(payload);
          if (parsed === null) {
            throw new Error("content must be valid JSON string when contentType is application/json");
          }
          payload = parsed;
        } else if (!(payload && typeof payload === "object")) {
          throw new Error("content must be object or JSON string when contentType is application/json");
        }
      } else if (typeof payload !== "string") {
        payload = String(payload);
      }

      const endpoint = `/api/session-data${encodeQuery({ path: relPath })}`;
      const result = await fetchEndpoint(cfg, endpoint, {
        method: "POST",
        headers: { "content-type": ct },
        body: payload,
      });

      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }

      return {
        ok: true,
        status: result.status,
        path: relPath,
        response: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

function sessionListToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_session_list",
    "List files under an OpenRoom session directory",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    async (params) => {
      const relPath = buildSessionPathParams(params);
      const endpoint = `/api/session-data${encodeQuery({ action: "list", path: relPath })}`;
      const result = await fetchEndpoint(cfg, endpoint, { method: "GET" });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }
      return {
        ok: true,
        status: result.status,
        path: relPath,
        files: result.json?.files || [],
        notExists: !!result.json?.not_exists,
      };
    },
    logger,
    cfg,
  );
}

function sessionDeleteToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_session_delete",
    "Delete one OpenRoom session file by path",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    async (params) => {
      const relPath = buildSessionPathParams(params);
      const endpoint = `/api/session-data${encodeQuery({ path: relPath })}`;
      const result = await fetchEndpoint(cfg, endpoint, { method: "DELETE" });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }
      return {
        ok: true,
        status: result.status,
        path: relPath,
        response: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

function sessionResetToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_session_reset",
    "Delete one OpenRoom session directory by path",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    async (params) => {
      const relPath = buildSessionPathParams(params);
      const endpoint = `/api/session-reset${encodeQuery({ path: relPath })}`;
      const result = await fetchEndpoint(cfg, endpoint, { method: "DELETE" });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }
      return {
        ok: true,
        status: result.status,
        path: relPath,
        response: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

function jsonResourceGetToolFactory(name, endpoint, desc, logger, cfg) {
  return buildSimpleTool(
    name,
    desc,
    {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async () => {
      const result = await fetchEndpoint(cfg, endpoint, { method: "GET" });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }
      return {
        ok: true,
        status: result.status,
        data: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

function jsonResourceSetToolFactory(name, endpoint, desc, logger, cfg) {
  return buildSimpleTool(
    name,
    desc,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        data: {
          description: "Resource object or JSON string",
        },
      },
      required: ["data"],
    },
    async (params) => {
      const payload = resolveJsonPayload(asObject(params).data, "data");
      const result = await fetchEndpoint(cfg, endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }
      return {
        ok: true,
        status: result.status,
        response: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

function llmProxyToolFactory(logger, cfg) {
  return buildSimpleTool(
    "openroom_llm_proxy",
    "Call OpenRoom /api/llm-proxy endpoint with target URL",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        targetUrl: { type: "string" },
        method: { type: "string" },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
        },
        body: {
          description: "Request body (string or object)",
        },
      },
      required: ["targetUrl"],
    },
    async (params) => {
      const p = asObject(params);
      const targetUrl = asString(p.targetUrl, "");
      if (!targetUrl) {
        throw new Error("targetUrl is required");
      }

      const headersInput = asObject(p.headers);
      const headers = {
        "x-llm-target-url": targetUrl,
      };

      for (const [k, v] of Object.entries(headersInput)) {
        if (typeof v === "string") {
          headers[`x-custom-${k}`] = v;
        }
      }

      let body = p.body;
      if (body && typeof body === "object") {
        body = JSON.stringify(body);
        headers["content-type"] = "application/json";
      } else if (typeof body === "string" && body) {
        headers["content-type"] = headers["content-type"] || "application/json";
      } else if (body === undefined || body === null) {
        body = "";
      }

      const method = asString(p.method, "POST").toUpperCase();
      const result = await fetchEndpoint(cfg, "/api/llm-proxy", {
        method,
        headers,
        body,
      });

      if (!result.ok) {
        throw new Error(result.error || result.text || `http_${result.status}`);
      }

      return {
        ok: true,
        status: result.status,
        contentType: result.contentType,
        response: result.json ?? result.text,
      };
    },
    logger,
    cfg,
  );
}

async function runCommand(name, cfg) {
  if (name === "openroom_health") {
    const health = await probeHealth(cfg);
    return health.ok
      ? { text: toJsonText({ ok: true, healthy: true, baseUrl: cfg.baseUrl }) }
      : { text: toJsonText({ ok: false, healthy: false, baseUrl: cfg.baseUrl, error: health.error }), isError: true };
  }

  if (name === "openroom_up") {
    const started = await startDevServer(cfg);
    const probe = await waitForHealthy(cfg, cfg.startupWaitSec);
    return {
      text: toJsonText({ ok: probe.ok, started, probe }),
      isError: !probe.ok,
    };
  }

  if (name === "openroom_down") {
    const stopped = await stopDevServer(cfg);
    return {
      text: toJsonText(stopped),
      isError: false,
    };
  }

  return { text: `${name} not implemented`, isError: true };
}

const plugin = {
  id: "openclaw-openroom-bridge",
  name: "OpenClaw OpenRoom Bridge",
  description: "Bridge OpenClaw tools with OpenRoom local APIs",
  register(api) {
    const cfg = loadConfig(api.pluginConfig || {});

    if (!cfg.enabled) {
      api.logger.info("[openroom-bridge] disabled by config");
      return;
    }

    if (typeof api.registerTool === "function") {
      const tools = [
        healthToolFactory(api.logger, cfg),
        startToolFactory(api.logger, cfg),
        stopToolFactory(api.logger, cfg),
        llmConfigGetToolFactory(api.logger, cfg),
        llmConfigSetToolFactory(api.logger, cfg),
        sessionReadToolFactory(api.logger, cfg),
        sessionWriteToolFactory(api.logger, cfg),
        sessionListToolFactory(api.logger, cfg),
        sessionDeleteToolFactory(api.logger, cfg),
        sessionResetToolFactory(api.logger, cfg),
        jsonResourceGetToolFactory(
          "openroom_characters_get",
          "/api/characters",
          "Read OpenRoom characters resource",
          api.logger,
          cfg,
        ),
        jsonResourceSetToolFactory(
          "openroom_characters_set",
          "/api/characters",
          "Write OpenRoom characters resource",
          api.logger,
          cfg,
        ),
        jsonResourceGetToolFactory(
          "openroom_mods_get",
          "/api/mods",
          "Read OpenRoom mods resource",
          api.logger,
          cfg,
        ),
        jsonResourceSetToolFactory(
          "openroom_mods_set",
          "/api/mods",
          "Write OpenRoom mods resource",
          api.logger,
          cfg,
        ),
        llmProxyToolFactory(api.logger, cfg),
      ];

      for (const tool of tools) {
        api.registerTool(() => tool);
      }

      api.logger.info(`[openroom-bridge] registered ${tools.length} tools`);
    } else {
      api.logger.warn("[openroom-bridge] registerTool API unavailable");
    }

    const commands = [
      ["openroom_health", "Check OpenRoom health"],
      ["openroom_up", "Start OpenRoom dev server and wait for healthy"],
      ["openroom_down", "Stop OpenRoom dev server"],
    ];

    for (const [name, description] of commands) {
      api.registerCommand({
        name,
        description,
        acceptsArgs: false,
        handler: async () => runCommand(name, cfg),
      });
    }

    api.logger.info("[openroom-bridge] registered commands: openroom_health/openroom_up/openroom_down");
  },
};

export default plugin;
