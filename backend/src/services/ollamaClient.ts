import axios from 'axios';
import { logger } from '../utils/logger';

const BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

export async function askOllama(prompt: string, model = 'llama3.1:8b', timeoutMs = 25000): Promise<string | null> {
  try {
    const { data } = await axios.post(
      `${BASE}/api/generate`,
      { model, prompt, stream: false, format: 'json' },
      { timeout: timeoutMs }
    );
    return data?.response || null;
  } catch (err: any) {
    logger.warn(`Ollama unavailable (${err?.message || err}) — skipping Tier 2`);
    return null;
  }
}

export async function ollamaAvailable(): Promise<boolean> {
  try {
    await axios.get(`${BASE}/api/tags`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}
