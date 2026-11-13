import Groq from 'groq-sdk';

// Environment-backed model configurations
export const GROQ_CONFIG = {
  apiKey: process.env.GROQ_API_KEY || '',
  primaryModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  fallbackModel: process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b',
  primarySTTModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  fallbackSTTModel: process.env.GROQ_STT_FALLBACK_MODEL || 'whisper-large-v3',
  timeoutMs: 25000,
};

let groqInstance: Groq | null = null;

export function getGroqClient(): Groq {
  if (!groqInstance) {
    const key = process.env.GROQ_API_KEY || GROQ_CONFIG.apiKey;
    if (!key) {
      throw new Error('GROQ_API_KEY is not configured in environment variables.');
    }
    groqInstance = new Groq({
      apiKey: key,
      timeout: GROQ_CONFIG.timeoutMs,
    });
  }
  return groqInstance;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface GroqChatOptions {
  messages: ChatMessage[];
  tools?: any[];
  tool_choice?: 'auto' | 'none' | 'required' | any;
  temperature?: number;
  max_tokens?: number;
}

/**
 * Execute chat completion with automatic fallback to secondary model on failure.
 */
export async function createChatCompletionWithFallback(
  options: GroqChatOptions
): Promise<{
  message: any;
  modelUsed: string;
  finishReason: string;
}> {
  const client = getGroqClient();
  const primary = GROQ_CONFIG.primaryModel;
  const fallback = GROQ_CONFIG.fallbackModel;

  // Try primary model
  try {
    const response = await client.chat.completions.create({
      model: primary,
      messages: options.messages as any,
      tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
      tool_choice: options.tools && options.tools.length > 0 ? options.tool_choice || 'auto' : undefined,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens ?? 1024,
    });

    const choice = response.choices[0];
    return {
      message: choice.message,
      modelUsed: primary,
      finishReason: choice.finish_reason || 'stop',
    };
  } catch (primaryError: any) {
    console.warn(`[Groq Primary Model Error (${primary})]:`, primaryError?.message || primaryError);
    
    // If fallback is configured and different from primary, retry with fallback
    if (fallback && fallback !== primary) {
      console.info(`[Groq Fallback]: Retrying completion with fallback model ${fallback}...`);
      try {
        const response = await client.chat.completions.create({
          model: fallback,
          messages: options.messages as any,
          tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
          tool_choice: options.tools && options.tools.length > 0 ? options.tool_choice || 'auto' : undefined,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.max_tokens ?? 1024,
        });

        const choice = response.choices[0];
        return {
          message: choice.message,
          modelUsed: fallback,
          finishReason: choice.finish_reason || 'stop',
        };
      } catch (fallbackError: any) {
        console.error(`[Groq Fallback Model Error (${fallback})]:`, fallbackError?.message || fallbackError);
        throw new Error(`Groq LLM service failed on both ${primary} and fallback ${fallback}: ${fallbackError.message}`);
      }
    }
    throw primaryError;
  }
}

/**
 * Transcribe audio using Groq Whisper with automatic fallback.
 */
export async function transcribeAudioWithFallback(
  file: File | Blob,
  prompt?: string
): Promise<{ text: string; modelUsed: string }> {
  const client = getGroqClient();
  const primary = GROQ_CONFIG.primarySTTModel;
  const fallback = GROQ_CONFIG.fallbackSTTModel;

  try {
    const transcription = await client.audio.transcriptions.create({
      file: file as any,
      model: primary,
      prompt: prompt || 'Knotopian Institute of Technology, Attendance, On-duty, Leave application, Examination, Placement, Admissions, Arjun, Dr. Lakshmi, CSE-2A',
      response_format: 'verbose_json',
      temperature: 0.0,
    });
    return {
      text: (transcription.text || '').trim(),
      modelUsed: primary,
    };
  } catch (primaryErr: any) {
    console.warn(`[Groq Whisper Primary Error (${primary})]:`, primaryErr?.message || primaryErr);
    if (fallback && fallback !== primary) {
      console.info(`[Groq Whisper Fallback]: Retrying audio transcription with ${fallback}...`);
      try {
        const transcription = await client.audio.transcriptions.create({
          file: file as any,
          model: fallback,
          prompt: prompt,
          response_format: 'verbose_json',
          temperature: 0.0,
        });
        return {
          text: (transcription.text || '').trim(),
          modelUsed: fallback,
        };
      } catch (fallbackErr: any) {
        console.error(`[Groq Whisper Fallback Error (${fallback})]:`, fallbackErr?.message || fallbackErr);
        throw new Error(`Groq Whisper failed on both ${primary} and fallback ${fallback}: ${fallbackErr.message}`);
      }
    }
    throw primaryErr;
  }
}
