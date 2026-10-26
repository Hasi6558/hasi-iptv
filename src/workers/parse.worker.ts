import { M3UParser, type ParseOptions } from '../lib/m3u/parser';

type Request = { text: string; options: ParseOptions };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<Request>) => {
  try {
    const parser = new M3UParser(event.data.text, event.data.options);
    let lastReport = 0;
    while (!parser.step(5000)) {
      if (parser.progress - lastReport >= 0.05) {
        lastReport = parser.progress;
        ctx.postMessage({ type: 'progress', progress: parser.progress });
      }
    }
    ctx.postMessage({ type: 'done', result: parser.result() });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
