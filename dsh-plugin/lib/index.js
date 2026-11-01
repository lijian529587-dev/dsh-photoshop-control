/**
 * DeepSeek Harness host plugin — drive local Adobe Photoshop through Windows COM.
 *
 * Every tool forwards a JSON payload to `scripts/photoshop_bridge.ps1`, which
 * attaches to Photoshop's COM automation server and evaluates ExtendScript.
 * The plugin itself has no runtime dependencies: no Python, no npm packages.
 *
 * @module dsh-photoshop-control
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin identity. */
export const name = "tool-photoshop";

/** The registry the tools register into. */
export const inject = ["tools"];

const here = dirname(fileURLToPath(import.meta.url));

/** Upper bound the host waits for one tool call, before the bridge's own timeout. */
const CALL_TIMEOUT_MS = 320_000;

let cachedBridge = "";

/**
 * Locate the PowerShell bridge.
 *
 * Resolution order: `PHOTOSHOP_BRIDGE`, the copy shipped inside the package, then
 * the repository-level `scripts/` directory (the layout used when this bundle is
 * installed with `link:` from a checkout).
 *
 * @returns absolute path of the bridge script.
 * @throws when no candidate exists, so the failure names every path tried.
 */
function bridgePath() {
  if (cachedBridge !== "") return cachedBridge;
  const candidates = [
    process.env.PHOTOSHOP_BRIDGE,
    join(here, "..", "scripts", "photoshop_bridge.ps1"),
    join(here, "..", "..", "scripts", "photoshop_bridge.ps1"),
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedBridge = candidate;
      return cachedBridge;
    }
  }
  throw new Error(`photoshop_bridge.ps1 not found. Set PHOTOSHOP_BRIDGE. Tried: ${candidates.join(", ")}`);
}

/**
 * Run a child process to completion with a hard timeout.
 *
 * @param command - executable to spawn.
 * @param args - argument vector, never a shell string.
 * @param timeoutMs - wall clock budget before the child is killed.
 * @returns captured exit code, stdout and stderr.
 */
function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Photoshop bridge timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Forward one action to the PowerShell bridge and parse its JSON answer.
 *
 * The payload travels through a temporary file rather than the command line, so
 * paths, Chinese text and quotes never pass through shell parsing.
 *
 * @param action - bridge action name.
 * @param payload - tool arguments; `progId` and `timeoutSeconds` are consumed here.
 * @returns the bridge's decoded result object.
 * @throws when the bridge fails, times out, or answers with non-JSON.
 */
async function bridge(action, payload = {}) {
  const { progId, timeoutSeconds, ...rest } = payload ?? Object.create(null);
  const seconds = Math.max(5, Math.min(300, Number(timeoutSeconds) || 60));
  const dir = await mkdtemp(join(tmpdir(), "dsh-photoshop-"));
  const file = join(dir, "payload.json");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    bridgePath(),
    "-Action",
    action,
    "-JsonFile",
    file,
  ];
  if (typeof progId === "string" && progId.length > 0) args.push("-ProgId", progId);
  try {
    await writeFile(file, JSON.stringify(rest), "utf8");
    const { code, stdout, stderr } = await run("powershell.exe", args, seconds * 1000 + 15_000);
    const text = stdout.trim();
    if (text.length === 0) {
      throw new Error(`Photoshop bridge produced no output (exit ${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Photoshop bridge returned non-JSON output: ${text.slice(0, 600)}${stderr.trim() ? ` | ${stderr.trim()}` : ""}`);
    }
    if (parsed?.ok === false) {
      throw new Error(`photoshop ${action} failed: ${parsed.error ?? "unknown error"}`);
    }
    return parsed;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Model-facing result envelope shared by every tool. */
const OUTPUT = {
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      text: { type: "string", description: "JSON document describing the Photoshop result." },
    },
  },
  render: (_args, value) => [{ type: "text", text: value.text }],
};

/**
 * Wrap a bridge result as the tool's structured value.
 *
 * @param value - decoded bridge output.
 * @returns the `{ text }` envelope the output schema accepts.
 */
function envelope(value) {
  return { text: JSON.stringify(value, null, 2) };
}

/**
 * Build a JSON Schema object for a tool's arguments.
 *
 * @param properties - declared argument schemas.
 * @param required - argument names the model must supply.
 * @returns the schema the registry publishes to the model.
 */
function schema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

const PROG_ID = {
  type: "string",
  description: "Optional Photoshop COM ProgID override, for example Photoshop.Application.2024.",
};
const TIMEOUT = {
  type: "integer",
  minimum: 5,
  maximum: 300,
  description: "Seconds to wait for Photoshop. Defaults to 60; raise it when Photoshop is starting cold.",
};
const BLEND = {
  type: "string",
  enum: ["NORMAL", "COLOR", "HUE", "MULTIPLY", "SCREEN", "OVERLAY", "SOFTLIGHT"],
  description: "Photoshop blend mode. Defaults to NORMAL.",
};
const POINT = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } },
};

/** Tool definitions, in the order the model sees them. */
const DEFINITIONS = [
  {
    name: "photoshop_status",
    description:
      "Check whether local Photoshop can be reached and report the active document. Call this first before any other Photoshop tool.",
    parameters: schema({ progId: PROG_ID, timeoutSeconds: TIMEOUT }),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Photoshop status", kind: "read" }),
    execute: async (args) => envelope(await bridge("status", args)),
  },
  {
    name: "photoshop_find_progids",
    description:
      "List the Photoshop COM ProgIDs registered on this Windows machine without launching Photoshop. Use it when photoshop_status cannot attach.",
    parameters: schema({}),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Find Photoshop ProgIDs", kind: "read" }),
    execute: async () => envelope(await bridge("find_progids", {})),
  },
  {
    name: "photoshop_open_image",
    description: "Open a local image file in Photoshop and return the document information.",
    parameters: schema(
      {
        path: { type: "string", description: "Absolute path of the image file." },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["path"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Open image in Photoshop", kind: "other" }),
    execute: async (args) => envelope(await bridge("open_image", args)),
  },
  {
    name: "photoshop_create_document",
    description:
      "Create a new Photoshop document with a specified canvas size, resolution and background. Use it to start a design from scratch.",
    parameters: schema(
      {
        widthPx: { type: "number", minimum: 1, description: "Canvas width in pixels." },
        heightPx: { type: "number", minimum: 1, description: "Canvas height in pixels." },
        name: { type: "string", description: "Document name." },
        resolution: { type: "number", minimum: 1, description: "Pixels per inch. Defaults to 72." },
        backgroundColor: { type: "string", description: "#RRGGBB background. Defaults to white." },
        transparent: { type: "boolean", description: "Create a transparent background instead of a filled one." },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["widthPx", "heightPx"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Create Photoshop document", kind: "other" }),
    execute: async (args) => envelope(await bridge("create_document", args)),
  },
  {
    name: "photoshop_place_image",
    description:
      "Place a local image into the active document as a new layer, with optional position, scale, opacity and blend mode.",
    parameters: schema(
      {
        imagePath: { type: "string", description: "Absolute path of the image to place." },
        layerName: { type: "string" },
        leftPx: { type: "number", description: "Target left pixel of the placed bounds." },
        topPx: { type: "number", description: "Target top pixel of the placed bounds." },
        widthPx: { type: "number", minimum: 1, description: "Target width in pixels." },
        heightPx: { type: "number", minimum: 1, description: "Target height in pixels." },
        opacity: { type: "number", minimum: 0, maximum: 100 },
        blendMode: BLEND,
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["imagePath"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Place image layer", kind: "other" }),
    execute: async (args) => envelope(await bridge("place_image", args)),
  },
  {
    name: "photoshop_add_text_layer",
    description: "Create an editable Photoshop text layer in the active document.",
    parameters: schema(
      {
        text: { type: "string", description: "Text content." },
        layerName: { type: "string" },
        xPx: { type: "number", description: "Text anchor X in pixels." },
        yPx: { type: "number", description: "Text anchor Y in pixels." },
        font: { type: "string", description: "PostScript font name, for example MicrosoftYaHei-Bold." },
        sizePx: { type: "number", minimum: 1 },
        color: { type: "string", description: "#RRGGBB text color." },
        justification: { type: "string", enum: ["LEFT", "CENTER", "RIGHT"] },
        opacity: { type: "number", minimum: 0, maximum: 100 },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["text", "xPx", "yPx"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Add text layer", kind: "other" }),
    execute: async (args) => envelope(await bridge("add_text_layer", args)),
  },
  {
    name: "photoshop_layer_ops",
    description:
      "List, select, rename, delete, show, hide, set opacity or set blend mode for layers of the active document.",
    parameters: schema(
      {
        operation: {
          type: "string",
          enum: ["list", "select", "rename", "delete", "show", "hide", "setOpacity", "setBlendMode"],
        },
        layerName: { type: "string", description: "Target layer name for operations other than list." },
        newName: { type: "string", description: "New name for rename." },
        opacity: { type: "number", minimum: 0, maximum: 100 },
        blendMode: BLEND,
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["operation"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Photoshop layer operation", kind: "other" }),
    execute: async (args) => envelope(await bridge("layer_ops", args)),
  },
  {
    name: "photoshop_draw_paths",
    description:
      "Create editable Photoshop vector paths from point data, optionally stroking them onto a visible ink layer. Paths stay editable with the direct-selection tool.",
    parameters: schema(
      {
        paths: {
          type: "array",
          description: "Paths to create.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "points"],
            properties: {
              name: { type: "string" },
              closed: { type: "boolean" },
              stroke: { type: "boolean", description: "Stroke the path with the current Photoshop brush." },
              strokeColor: { type: "string", description: "#RRGGBB foreground color used before stroking." },
              points: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["x", "y"],
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    leftX: { type: "number" },
                    leftY: { type: "number" },
                    rightX: { type: "number" },
                    rightY: { type: "number" },
                    smooth: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
        groupName: { type: "string" },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["paths"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Draw editable paths", kind: "other" }),
    execute: async (args) => envelope(await bridge("draw_paths", args)),
  },
  {
    name: "photoshop_adjust_image",
    description:
      "Apply common edits to the active document — optional open, crop, resize, brightness, contrast, sharpening — and optionally save a copy.",
    parameters: schema({
      inputPath: { type: "string", description: "Optional absolute input path to open first." },
      outputPath: { type: "string", description: "Optional absolute output path to save a copy." },
      widthPx: { type: "number", description: "Target width in pixels." },
      heightPx: { type: "number", description: "Target height in pixels." },
      brightness: { type: "integer", minimum: -150, maximum: 150 },
      contrast: { type: "integer", minimum: -50, maximum: 100 },
      crop: {
        type: "object",
        additionalProperties: false,
        required: ["left", "top", "right", "bottom"],
        description: "Crop rectangle in pixels.",
        properties: {
          left: { type: "number" },
          top: { type: "number" },
          right: { type: "number" },
          bottom: { type: "number" },
        },
      },
      sharpen: { type: "boolean", description: "Apply a mild unsharp mask." },
      jpegQuality: { type: "integer", minimum: 1, maximum: 12 },
      progId: PROG_ID,
      timeoutSeconds: TIMEOUT,
    }),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Adjust image", kind: "other" }),
    execute: async (args) => envelope(await bridge("adjust_image", args)),
  },
  {
    name: "photoshop_export_active",
    description: "Save a copy of the active Photoshop document as PNG, JPEG, TIFF or PSD.",
    parameters: schema(
      {
        outputPath: { type: "string", description: "Absolute output path; the extension picks the format." },
        jpegQuality: { type: "integer", minimum: 1, maximum: 12 },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["outputPath"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Export active document", kind: "other" }),
    execute: async (args) => envelope(await bridge("export_active", args)),
  },
  {
    name: "photoshop_apply_overlay",
    description:
      "Paste a transparent overlay image into the active document as a layer, set its blend mode and opacity, and align its visible bounds.",
    parameters: schema(
      {
        overlayPath: { type: "string", description: "Absolute path of a transparent overlay image." },
        layerName: { type: "string" },
        blendMode: BLEND,
        opacity: { type: "number", minimum: 0, maximum: 100 },
        boundsLeftPx: { type: "number", description: "Target left pixel for the visible overlay bounds." },
        boundsTopPx: { type: "number", description: "Target top pixel for the visible overlay bounds." },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["overlayPath"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Apply overlay layer", kind: "other" }),
    execute: async (args) => envelope(await bridge("apply_overlay", args)),
  },
  {
    name: "photoshop_texture_recolor",
    description:
      "Recolor a polygonal region while keeping the original texture: the fill layer is set to the COLOR blend mode, so folds, highlights and shadows survive. Prefer it over a flat color block.",
    parameters: schema(
      {
        targetColor: { type: "string", description: "Target color as #RRGGBB, for example #C81F2D." },
        maskPolygons: {
          type: "array",
          description: "Polygon masks in document pixels; each polygon is an array of {x,y} points.",
          items: { type: "array", items: POINT },
        },
        layerName: { type: "string", description: "Name of the generated layer." },
        removeLayerNames: {
          type: "array",
          items: { type: "string" },
          description: "Existing layer names to remove before recoloring.",
        },
        opacity: { type: "number", minimum: 0, maximum: 100 },
        featherPx: { type: "number", minimum: 0, maximum: 20, description: "Selection feather in pixels." },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["targetColor", "maskPolygons"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Texture-preserving recolor", kind: "other" }),
    execute: async (args) => envelope(await bridge("texture_recolor", args)),
  },
  {
    name: "photoshop_run_jsx",
    description:
      "Run custom ExtendScript JSX inside Photoshop. Use it only when the structured tools cannot express the edit: it is arbitrary code running with the user's privileges.",
    parameters: schema(
      {
        jsx: { type: "string", description: "ExtendScript source, evaluated as the body of a function; end with an expression to return a value." },
        progId: PROG_ID,
        timeoutSeconds: TIMEOUT,
      },
      ["jsx"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Run Photoshop ExtendScript", kind: "other" }),
    execute: async (args) => envelope(await bridge("run_jsx", args)),
  },
  {
    name: "photoshop_batch",
    description:
      "Run several Photoshop tool calls in order — the repeatable workflow primitive for office and design automation. Nested batches are rejected.",
    parameters: schema(
      {
        steps: {
          type: "array",
          description: "Steps to run in order.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["tool", "arguments"],
            properties: {
              tool: { type: "string", description: "Tool name, for example photoshop_create_document." },
              arguments: { type: "object", additionalProperties: true, description: "Arguments for that tool." },
            },
          },
        },
        stopOnError: { type: "boolean", description: "Defaults to true." },
      },
      ["steps"],
    ),
    output: OUTPUT,
    presentCall: () => ({ card: "generic", title: "Run Photoshop batch", kind: "other" }),
    execute: async (args) => envelope(await batch(args)),
  },
];

/** Tool name to definition, used by the batch tool. */
const BY_NAME = new Map();

/**
 * Run a sequence of tools, stopping at the first failure when asked.
 *
 * @param args - `{ steps, stopOnError }` as supplied by the model.
 * @returns per-step results plus whether the whole batch succeeded.
 */
async function batch(args) {
  const stopOnError = args.stopOnError !== false;
  const results = [];
  const steps = Array.isArray(args.steps) ? args.steps : [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] ?? {};
    const toolName = String(step.tool ?? "");
    let result;
    if (toolName === "photoshop_batch") {
      result = { ok: false, error: "Nested photoshop_batch calls are not allowed." };
    } else {
      const definition = BY_NAME.get(toolName);
      if (definition === undefined) {
        result = { ok: false, error: `Unknown tool: ${toolName}` };
      } else {
        try {
          const value = await definition.execute(step.arguments ?? {}, undefined);
          result = { ok: true, result: JSON.parse(value.text) };
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    }
    results.push({ index, tool: toolName, ...result });
    if (stopOnError && result.ok !== true) return { ok: false, stoppedAt: index, results };
  }
  return { ok: results.every((item) => item.ok === true), results };
}

/**
 * Register every Photoshop tool on the tool registry.
 *
 * A rejection is logged rather than thrown: activation runs inside the host's
 * boot path, where one throwing plugin would take the whole profile down.
 *
 * @param ctx - registrant context carrying `ctx.tools`.
 */
export function apply(ctx) {
  for (const definition of DEFINITIONS) {
    BY_NAME.set(definition.name, definition);
  }
  for (const definition of DEFINITIONS) {
    try {
      ctx.tools.register({ ...definition, timeoutMs: CALL_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        ctx.logger?.warn?.(`photoshop-control: could not register ${definition.name}: ${message}`);
      } catch {
        // Logging must never be the reason activation fails.
      }
    }
  }
}
