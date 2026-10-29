import { completion, loadModel, unloadModel, QWEN3_600M_INST_Q4, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import type { CallTool, ToolDef } from '../akiba/agent.ts';
import type { ChatMessage } from './schemas.ts';

/**
 * The only file that talks to QVAC. Same code on the phone (React Native
 * client) and in scripts/eval (Node client) — @qvac/sdk picks the transport.
 *
 * Each decision is one non-streaming completion constrained by
 * `responseFormat: json_schema`: llama.cpp compiles the schema to a grammar,
 * so the output always parses and enums always hold. Numeric bounds are NOT
 * enforced by the grammar, which is why schemas use enums and
 * src/akiba/validate.ts re-checks everything.
 */

export const AKIBA_MODELS = {
  small: { src: QWEN3_600M_INST_Q4, name: 'Qwen3 0.6B Instruct (Q4)', downloadSize: '0.4 GB' },
  large: { src: QWEN3_1_7B_INST_Q4, name: 'Qwen3 1.7B Instruct (Q4)', downloadSize: '1.1 GB' },
} as const;
export type AkibaModelSize = keyof typeof AKIBA_MODELS;

// Which size a phone runs is decided by its RAM: see src/ai/modelChoice.ts.
// Prompts are ~150 tokens; small context keeps memory low on a 3.6 GB phone.
const CTX_SIZE = 1024;
// Two 120-char reasons plus JSON fit in ~150 tokens; headroom for Swahili,
// which tokenizes less efficiently than English.
const MAX_OUTPUT_TOKENS = 256;

export interface RunStats {
  task: string;
  latencyMs: number;
  tokensPerSecond: number | null;
  ok: boolean;
  error?: string;
}

let modelId: string | null = null;

export async function loadAkibaModel(size: AkibaModelSize = 'small', onProgress?: (percent: number) => void): Promise<string> {
  if (modelId) return modelId;
  modelId = await loadModel({
    modelSrc: AKIBA_MODELS[size].src,
    modelType: 'llm',
    // CPU only: QVAC's default GPU path segfaulted while reserving the
    // compute graph on the Redmi 10's Mali GPU (QVAC targets Vulkan/Adreno on
    // Android). CPU is slower but predictable on budget phones.
    modelConfig: { ctx_size: CTX_SIZE, device: 'cpu', gpu_layers: 0 },
    onProgress: onProgress ? (p: { percentage: number }) => onProgress(p.percentage) : undefined,
  });
  return modelId;
}

/** Called before the wallet unlocks: never keep the LLM resident next to WDK. */
export async function unloadAkibaModel(): Promise<void> {
  if (!modelId) return;
  const id = modelId;
  modelId = null;
  await unloadModel({ modelId: id });
}

export function isAkibaModelLoaded(): boolean {
  return modelId != null;
}

export function makeQvacCallTool(onStats?: (s: RunStats) => void): CallTool {
  return async (messages: ChatMessage[], tool: ToolDef) => {
    if (!modelId) return null;
    const started = Date.now();
    try {
      const run = completion({
        modelId,
        history: messages,
        stream: false,
        generationParams: { predict: MAX_OUTPUT_TOKENS, temp: 0 },
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: tool.name, schema: tool.parameters as Record<string, unknown>, strict: true },
        },
      });
      const final = await run.final;
      const tokensPerSecond = final.stats?.tokensPerSecond ?? null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(final.contentText);
      } catch (e) {
        const error = `${String(e)} | output: ${final.contentText.slice(0, 200)}`;
        onStats?.({ task: tool.name, latencyMs: Date.now() - started, tokensPerSecond, ok: false, error });
        return null;
      }
      onStats?.({ task: tool.name, latencyMs: Date.now() - started, tokensPerSecond, ok: true });
      return parsed;
    } catch (e) {
      onStats?.({ task: tool.name, latencyMs: Date.now() - started, tokensPerSecond: null, ok: false, error: String(e) });
      return null;
    }
  };
}
