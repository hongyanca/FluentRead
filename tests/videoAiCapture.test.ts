import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VideoAiCaptureController,
  type VideoAiAudioChunk,
  type VideoAiTranscriptionResult,
} from '@/src/features/video-subtitle/content/video-ai/capture';
import {
  getVideoAiStreamProfile,
  VIDEO_AI_SAMPLE_RATE,
} from '@/src/features/video-subtitle/content/video-ai/audioWindow';

class FakeMediaStreamTrack {
  stopCount = 0;

  private readonly endedListeners = new Set<() => void>();

  stop(): void {
    this.stopCount += 1;
  }

  clone(): MediaStreamTrack {
    return new FakeMediaStreamTrack() as unknown as MediaStreamTrack;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'ended') return;
    this.endedListeners.add(() => {
      if (typeof listener === 'function') listener(new Event('ended'));
      else listener.handleEvent(new Event('ended'));
    });
  }

  removeEventListener(type: string): void {
    if (type === 'ended') this.endedListeners.clear();
  }

  emitEnded(): void {
    [...this.endedListeners].forEach((listener) => listener());
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeMediaStreamTrack[] = []) {}

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks as unknown as MediaStreamTrack[];
  }

  getTracks(): MediaStreamTrack[] {
    return this.getAudioTracks();
  }
}

class FakeAudioNode {
  static disconnectError: unknown = null;
  disconnectCount = 0;

  connect(): this {
    return this;
  }

  disconnect(): void {
    if (FakeAudioNode.disconnectError !== null) throw FakeAudioNode.disconnectError;
    this.disconnectCount += 1;
  }
}

class FakeScriptProcessorNode extends FakeAudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;

  emit(samples: Float32Array, sampleRate = VIDEO_AI_SAMPLE_RATE): void {
    this.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        sampleRate,
        getChannelData: () => samples,
      },
    } as unknown as AudioProcessingEvent);
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static resumeError: unknown = null;
  static sourceError: unknown = null;
  static processorError: unknown = null;

  state: AudioContextState = 'running';
  readonly destination = new FakeAudioNode();
  readonly processor = new FakeScriptProcessorNode();
  readonly source = new FakeAudioNode();
  readonly gain = new FakeGainNode();
  closeCount = 0;

  constructor(_options?: AudioContextOptions) {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    if (FakeAudioContext.sourceError !== null) throw FakeAudioContext.sourceError;
    return this.source as unknown as MediaStreamAudioSourceNode;
  }

  createScriptProcessor(): ScriptProcessorNode {
    if (FakeAudioContext.processorError !== null) throw FakeAudioContext.processorError;
    return this.processor as unknown as ScriptProcessorNode;
  }

  createGain(): GainNode {
    return this.gain as unknown as GainNode;
  }

  async resume(): Promise<void> {
    if (FakeAudioContext.resumeError !== null) throw FakeAudioContext.resumeError;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function speech(durationMs: number): Float32Array {
  const sampleCount = Math.round(durationMs * VIDEO_AI_SAMPLE_RATE / 1_000);
  return Float32Array.from(
    { length: sampleCount },
    (_, index) => 0.04 * Math.sin(2 * Math.PI * 220 * index / VIDEO_AI_SAMPLE_RATE),
  );
}

function silence(durationMs: number): Float32Array {
  return new Float32Array(Math.round(durationMs * VIDEO_AI_SAMPLE_RATE / 1_000));
}

function emitInProcessorBlocks(context: FakeAudioContext, pcm: Float32Array): void {
  const blockSize = 4_096;
  for (let offset = 0; offset < pcm.length; offset += blockSize) {
    context.processor.emit(pcm.subarray(offset, Math.min(pcm.length, offset + blockSize)));
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function createHarness(
  transcribe: (chunk: VideoAiAudioChunk) => Promise<VideoAiTranscriptionResult> = async () => ({ skipped: true }),
) {
  const sourceTracks: FakeMediaStreamTrack[] = [];
  const videoState: {
    currentTime: number;
    playbackRate: number;
    paused: boolean;
    ended: boolean;
    srcObject: MediaStream | null;
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  } = {
    currentTime: 0,
    playbackRate: 1,
    paused: false,
    ended: false,
    srcObject: null,
    captureStream: () => {
      const track = new FakeMediaStreamTrack();
      sourceTracks.push(track);
      return new FakeMediaStream([track]) as unknown as MediaStream;
    },
    mozCaptureStream: undefined,
  };
  const video = videoState as unknown as HTMLVideoElement;
  const onCue = vi.fn();
  const onReset = vi.fn();
  const onError = vi.fn();
  const onStateChange = vi.fn();
  const onDiagnostic = vi.fn();
  const onInvalidate = vi.fn();
  const onSessionStart = vi.fn();
  const transcribeSpy = vi.fn(transcribe);
  const controller = new VideoAiCaptureController({
    getVideo: () => video,
    getModel: () => 'tiny',
    isSupported: () => true,
    transcribe: transcribeSpy,
    onCue,
    onReset,
    onError,
    onStateChange,
    onDiagnostic,
    onInvalidate,
    onSessionStart,
  });

  return {
    controller,
    video: videoState,
    sourceTracks,
    transcribe: transcribeSpy,
    onCue,
    onReset,
    onError,
    onDiagnostic,
    onInvalidate,
    onSessionStart,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.instances = [];
  FakeAudioContext.resumeError = null;
  FakeAudioContext.sourceError = null;
  FakeAudioContext.processorError = null;
  FakeAudioNode.disconnectError = null;
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('window', {
    AudioContext: FakeAudioContext,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('VideoAiCaptureController 生命周期', () => {
  it('Small 视频结束后的在途识别超过五秒仍能写回自然尾句', async () => {
    const pending = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => pending.promise);
    (harness.controller as unknown as { options: { getModel: () => unknown } }).options.getModel = () => 'small';
    expect(harness.controller.start()).toBe(true);
    const profile = getVideoAiStreamProfile('small');
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledOnce();
    harness.video.ended = true;
    harness.video.paused = true;
    harness.controller.end(false);
    await vi.advanceTimersByTimeAsync(76_551);
    expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
    pending.resolve({text: 'The final complete sentence is retained.'});
    await flushPromises();
    expect(harness.onCue).toHaveBeenCalledWith(expect.objectContaining({text: 'The final complete sentence is retained.'}));
    expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['deadline', 'cancel'] as const)('Small 的长尾等待保持有限预算，%s 会清理并拒绝迟到结果', async reason => {
    const pending = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => pending.promise);
    (harness.controller as unknown as { options: { getModel: () => unknown } }).options.getModel = () => 'small';
    expect(harness.controller.start()).toBe(true);
    const profile = getVideoAiStreamProfile('small');
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    harness.video.ended = true;
    harness.controller.end(false);
    await vi.advanceTimersByTimeAsync(reason === 'deadline' ? 199_999 : 5_001);
    expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
    if (reason === 'cancel') {
      harness.controller.cancel();
      expect(harness.controller.isRequested()).toBe(false);
      expect(harness.onInvalidate).toHaveBeenCalledWith('cancel', 1);
    } else {
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 1);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeAudioContext.instances[0].state).toBe('closed');
    pending.resolve({text: 'A stale late sentence must be ignored.'});
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(harness.onCue).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
    if (reason === 'cancel') expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
  });
  it('视频结束时等待在途尾窗写回，再取消 generation 并释放音频图', async () => {
    const finalResult = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => finalResult.promise);
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);

    harness.video.currentTime = 30;
    harness.video.paused = true;
    harness.video.ended = true;
    harness.controller.end(false);
    expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
    expect(FakeAudioContext.instances[0].state).toBe('closed');

    finalResult.resolve({ text: 'The final sentence arrives.' });
    await flushPromises();
    expect(harness.onCue).toHaveBeenCalledWith(expect.objectContaining({
      cueId: 'session-1:ai-1',
      text: 'The final sentence arrives.',
    }));
    expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.controller.isRequested()).toBe(true);
  });

  it('视频结束且当前空闲时，会强制提交不足正常步长但超过 0.9 秒的尾音频', async () => {
    const harness = createHarness(async () => ({ text: 'A complete sentence arrives.' }));
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledTimes(1);

    harness.video.currentTime += 1.2;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(1_200));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    harness.video.ended = true;
    harness.video.paused = true;
    harness.controller.end(false);
    expect(harness.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.transcribe.mock.calls[1][0].audioDurationMs).toBeGreaterThanOrEqual(1_000);
  });

  it('暂停恢复保留句子上下文，首个恢复窗口无需重新等满整段', () => {
    const harness = createHarness();
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);

    harness.video.currentTime = Math.max(0, profile.initialWindowMs - 200) / 1_000;
    emitInProcessorBlocks(
      FakeAudioContext.instances[0],
      speech(Math.max(0, profile.initialWindowMs - 200)),
    );
    expect(harness.transcribe).not.toHaveBeenCalled();
    harness.controller.pause();

    expect(harness.controller.start(false)).toBe(true);
    harness.video.currentTime = 4.4;
    emitInProcessorBlocks(FakeAudioContext.instances[1], speech(profile.initialWindowMs - 1_200));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    const resumedChunk = harness.transcribe.mock.calls[0][0];
    expect(resumedChunk.sessionId).toBe(2);
    expect(resumedChunk.audioDurationMs).toBeGreaterThanOrEqual(profile.initialWindowMs);
    expect(resumedChunk.startMs).toBeLessThan(harness.video.currentTime * 1_000);

    harness.controller.cancel();
  });

  it('暂停会失效当前 generation，且旧 Promise 的结果和 finally 不污染恢复会话', async () => {
    const oldResult = deferred<VideoAiTranscriptionResult>();
    const resumedResult = deferred<VideoAiTranscriptionResult>();
    const responses: Promise<VideoAiTranscriptionResult>[] = [
      oldResult.promise,
      resumedResult.promise,
    ];
    const harness = createHarness(async () => responses.shift() || { skipped: true });
    const profile = getVideoAiStreamProfile('tiny');

    expect(harness.controller.start()).toBe(true);
    expect(harness.onSessionStart).toHaveBeenLastCalledWith(1);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    expect(harness.transcribe.mock.calls[0][0].sessionId).toBe(1);

    harness.controller.pause();
    expect(harness.onInvalidate).toHaveBeenCalledWith('pause', 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.controller.isRequested()).toBe(true);

    expect(harness.controller.start(false)).toBe(true);
    expect(harness.onSessionStart).toHaveBeenLastCalledWith(2);
    harness.video.currentTime = profile.initialWindowMs * 2 / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[1], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.transcribe.mock.calls[1][0].sessionId).toBe(2);

    oldResult.resolve({ text: 'Old generation must never render.' });
    await flushPromises();
    expect(harness.onCue).not.toHaveBeenCalled();
    expect(harness.onDiagnostic).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();

    // 恢复后的请求仍在进行；旧请求的 finally 不得把 processing 清零并抢跑。
    harness.video.currentTime += profile.submitStepMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[1], speech(profile.submitStepMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(2);

    resumedResult.resolve({ text: 'New generation works now.' });
    await flushPromises();
    expect(harness.onCue).toHaveBeenCalledTimes(1);
    expect(harness.onCue.mock.calls[0][0].text).toBe('New generation works now.');
    expect(harness.onCue.mock.calls[0][0].cueId).toBe('session-2:ai-1');
    expect(harness.onDiagnostic.mock.calls.every(([diagnostic]) => diagnostic.sessionId === 2)).toBe(true);
    // 新请求完成后才允许追赶推理期间积累的音频。
    expect(harness.transcribe).toHaveBeenCalledTimes(3);

    harness.controller.cancel();
  });

  it.each([
    ['cancel', (harness: ReturnType<typeof createHarness>) => harness.controller.cancel()],
    ['seek', (harness: ReturnType<typeof createHarness>) => {
      harness.video.paused = true;
      harness.controller.resetAfterSeek();
    }],
    ['error', (harness: ReturnType<typeof createHarness>) => harness.sourceTracks[0].emitEnded()],
  ] as const)('%s 会释放捕获音轨和 AudioContext', (reason, stop) => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    const context = FakeAudioContext.instances[0];
    const track = harness.sourceTracks[0];

    stop(harness);

    expect(harness.onInvalidate).toHaveBeenCalledWith(reason, 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(track.stopCount).toBeGreaterThan(0);
    expect(context.closeCount).toBe(1);
    expect(context.state).toBe('closed');
    if (reason === 'error') {
      expect(harness.onError.mock.calls[0][0].message).toContain('音轨已结束');
      expect(harness.controller.isRequested()).toBe(false);
    }
  });

  it('seek reset waits for seeked before rebuilding the capture graph', () => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    harness.video.paused = false;
    harness.controller.resetAfterSeek();
    expect(harness.controller.isRunning()).toBe(false);
    vi.runAllTimers();
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.controller.resumeAfterSeek()).toBe(true);
    expect(harness.controller.isRunning()).toBe(true);
    harness.controller.cancel();
  });

  it('数字静音不提交，语音达到 Tiny 初始窗口时立即提交', () => {
    const profile = getVideoAiStreamProfile('tiny');
    const silentHarness = createHarness();
    expect(silentHarness.controller.start()).toBe(true);
    emitInProcessorBlocks(FakeAudioContext.instances[0], silence(profile.initialWindowMs));
    expect(silentHarness.transcribe).not.toHaveBeenCalled();
    silentHarness.controller.cancel();

    const speechHarness = createHarness();
    expect(speechHarness.controller.start()).toBe(true);
    const speechContext = FakeAudioContext.instances[1];
    speechHarness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(speechContext, speech(profile.initialWindowMs));

    expect(speechHarness.transcribe).toHaveBeenCalledTimes(1);
    expect(speechHarness.transcribe.mock.calls[0][0]).toMatchObject({
      sessionId: 1,
      sequence: 1,
      audioDurationMs: profile.initialWindowMs,
      durationMs: profile.initialWindowMs,
      playbackRate: 1,
    });
    expect(speechHarness.transcribe.mock.calls[0][0].pcm).toHaveLength(
      profile.initialWindowMs * VIDEO_AI_SAMPLE_RATE / 1_000,
    );
    speechHarness.controller.cancel();
  });
});

describe('VideoAiCaptureController 公共边界路径', () => {
  it('request 在暂停状态记录请求，随后 start 只建立一次采集图', () => {
    const harness = createHarness();
    harness.controller.pause();
    harness.controller.resetAfterSeek();
    harness.controller.resetAfterPlaybackRateChange();
    harness.controller.resumeAfterSeek();
    harness.controller.end();
    harness.controller.start();
    harness.video.playbackRate = 0;
    harness.video.currentTime = 1.7;
    FakeAudioContext.instances.at(-1)?.processor.emit(speech(1_700));
    harness.controller.pause();
    harness.video.paused = true;
    expect(harness.controller.isRequested()).toBe(true);
    harness.controller.request();
    expect(harness.controller.isRequested()).toBe(true);
    expect(harness.controller.start()).toBe(true);
    expect(harness.controller.start()).toBe(true);
    harness.controller.cancel();
  });

  it('支持 legacy captureStream 和 srcObject 音轨克隆回退', () => {
    const harness = createHarness();
    const sourceTrack = new FakeMediaStreamTrack();
    harness.video.captureStream = undefined;
    harness.video.mozCaptureStream = () => new FakeMediaStream() as unknown as MediaStream;
    harness.video.srcObject = new FakeMediaStream([sourceTrack]) as unknown as MediaStream;
    expect(harness.controller.start()).toBe(true);
    expect(harness.controller.isRunning()).toBe(true);
    harness.controller.cancel();
    expect(sourceTrack.stopCount).toBe(0);
  });

  it('报告不支持、缺少音轨和缺少 AudioContext 的启动错误', () => {
    const unsupported = createHarness();
    (unsupported.controller as unknown as { options: { isSupported: () => boolean } }).options.isSupported = () => false;
    expect(unsupported.controller.start()).toBe(false);
    expect(unsupported.controller.getError()).toBe('');

    const noTracks = createHarness();
    noTracks.video.captureStream = () => new FakeMediaStream() as unknown as MediaStream;
    expect(noTracks.controller.start()).toBe(false);
    expect(noTracks.onError).toHaveBeenCalled();

    const noContext = createHarness();
    vi.stubGlobal('window', {});
    expect(noContext.controller.start()).toBe(false);
    expect(noContext.onError).toHaveBeenCalled();
  });

  it('resume 失败时转成错误态并清理请求', async () => {
    FakeAudioContext.resumeError = 'resume failed';
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    await flushPromises();
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.controller.isRequested()).toBe(false);
    expect(harness.onError.mock.calls[0][0].message).toBe('resume failed');
  });

  it('播放头回退时使当前窗口失效并重置字幕时间轴', () => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    const context = FakeAudioContext.instances[0];
    harness.video.currentTime = 2;
    context.processor.emit(speech(300));
    harness.video.currentTime = 0;
    context.processor.emit(speech(300));
    expect(harness.onInvalidate).toHaveBeenCalledWith('seek', 1);
    expect(harness.onReset).toHaveBeenCalled();
    harness.controller.cancel();
  });

  it('倍速变化会重建活动采集，暂停或结束视频则不自动恢复', () => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    harness.video.playbackRate = 1.5;
    harness.controller.resetAfterPlaybackRateChange();
    vi.runAllTimers();
    expect(harness.onInvalidate).toHaveBeenCalledWith('ratechange', 1);
    expect(harness.controller.isRunning()).toBe(true);
    harness.video.paused = true;
    harness.controller.resetAfterPlaybackRateChange();
    vi.runAllTimers();
    expect(harness.controller.isRunning()).toBe(false);
    harness.controller.cancel();
  });

  it('跳过结果、分段缩放和推理耗时都会进入诊断', async () => {
    const responses: VideoAiTranscriptionResult[] = [
      { skipped: true, model: 'tiny' },
      {
        text: 'A complete sentence arrives now.',
        segments: [{ startMs: 0, endMs: 900, text: 'A complete sentence arrives now.' }],
        inferenceMs: 1_000,
      },
    ];
    const harness = createHarness(async () => responses.shift() || { text: '' });
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    await flushPromises();
    harness.video.currentTime += profile.submitStepMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.submitStepMs));
    await flushPromises();
    expect(harness.onDiagnostic.mock.calls.some(([diagnostic]) => diagnostic.skipped)).toBe(true);
    expect(harness.onDiagnostic.mock.calls.some(([diagnostic]) => diagnostic.inferenceMs === 1_000)).toBe(true);
    expect(harness.onCue).toHaveBeenCalled();
    harness.controller.cancel();
  });

  it('识别失败时进入错误态，超出音频缓冲上限时立即停止', async () => {
    const rejected = createHarness(async () => { throw new Error('transcribe failed'); });
    const profile = getVideoAiStreamProfile('tiny');
    expect(rejected.controller.start()).toBe(true);
    rejected.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    await flushPromises();
    expect(rejected.onError.mock.calls[0][0].message).toBe('transcribe failed');

  });

  it('结束空闲会按配置清除 cue，重复 destroy/cancel 保持幂等', () => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    harness.controller.end(true);
    expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 1);
    expect(harness.onReset).toHaveBeenCalled();
    harness.controller.destroy();
    harness.controller.destroy();
    harness.controller.cancel();
    expect(harness.controller.isRunning()).toBe(false);
  });

  it('AudioContext 建图失败时清理已创建资源并报告错误', () => {
    FakeAudioContext.sourceError = new Error('source failed');
    const harness = createHarness();
    expect(harness.controller.start()).toBe(false);
    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'source failed' }));
    expect(harness.sourceTracks[0].stopCount).toBeGreaterThan(0);
    expect(FakeAudioContext.instances[0].closeCount).toBe(1);
  });

  it.each(['base', 'small'])('%s 暂停保留更长上下文，结束在途识别使用对应有限预算', async model => {
    const result = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => result.promise);
    (harness.controller as unknown as { options: { getModel: () => unknown } }).options.getModel = () => model;
    expect(harness.controller.start()).toBe(true);
    const profile = getVideoAiStreamProfile(model);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    harness.controller.pause();
    expect(harness.onInvalidate).toHaveBeenCalledWith('pause', 1);

    expect(harness.controller.start(false)).toBe(true);
    harness.video.currentTime = profile.initialWindowMs * 2 / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances.at(-1)!, speech(profile.initialWindowMs));
    harness.video.ended = true;
    harness.video.paused = true;
    harness.controller.end(false);
    vi.advanceTimersByTime(model === 'small' ? 200_000 : 5_000);
    expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 2);
    result.resolve({ text: 'Base final sentence.' });
    await flushPromises();
    expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 2);
  });

  it('无效播放头仍以音频时长构造 chunk 和可用时间', async () => {
    const harness = createHarness(async () => ({ text: 'Fallback clock sentence.' }));
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);
    harness.video.currentTime = Number.NaN;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    await flushPromises();
    expect(harness.transcribe.mock.calls[0][0].startMs).toBe(0);
    expect(harness.onDiagnostic.mock.calls[0][0].resultAvailableAtMs).toBeGreaterThan(0);
    harness.controller.cancel();
    const idle = createHarness();
    idle.video.currentTime = Number.NaN;
    expect(idle.controller.start()).toBe(true);
    idle.controller.end();
  });

  it('超过窗口上限时同时覆盖整块移除和部分裁剪', () => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    const context = FakeAudioContext.instances[0];
    const block = speech(1_000);
    for (let index = 0; index < 30; index += 1) context.processor.emit(block);
    context.processor.emit(new Float32Array(100));
    expect(harness.controller.isRunning()).toBe(true);
    harness.controller.cancel();
  });

  it('连续窗口更新自适应步长、处理缺少分段时间并淘汰过期 cue 身份', async () => {
    let index = 0;
    const harness = createHarness(async () => {
      const current = index++;
      return {
      text: `Unique sentence number ${current} is complete.`,
      segments: [{ text: `Unique sentence number ${current} is complete.` }],
      inferenceMs: 100,
      };
    });
    expect(harness.controller.start()).toBe(true);
    const context = FakeAudioContext.instances[0];
    for (let round = 0; round < 132; round += 1) {
      harness.video.currentTime = (1_700 + round * 2_700) / 1_000;
      context.processor.emit(speech(round === 0 ? 1_700 : 2_700));
      await flushPromises();
    }
    expect(harness.onCue.mock.calls.length).toBeGreaterThan(128);
    expect(harness.onDiagnostic.mock.calls.at(-1)?.[0].effectiveSubmitStepMs).toBeGreaterThan(0);
    harness.controller.cancel();
  });

  it('识别拒绝非 Error 值时使用通用错误文案，旧处理器回调不会写回', async () => {
    const harness = createHarness(async () => { throw { failed: true }; });
    expect(harness.controller.start()).toBe(true);
    const context = FakeAudioContext.instances[0];
    context.processor.emit(new Float32Array());
    harness.video.currentTime = 1.7;
    context.processor.emit(speech(1_700));
    await flushPromises();
    expect(harness.onError.mock.calls[0][0].message).toBe('本地视频 AI 字幕失败');
    context.processor.emit(speech(300));
    expect(harness.onCue).not.toHaveBeenCalled();
  });

  it('请求状态存在但尚未建图时可重置倍速，断开节点异常也会继续清理', () => {
    const harness = createHarness();
    harness.controller.request();
    harness.controller.resetAfterPlaybackRateChange();
    expect(harness.controller.isRequested()).toBe(true);

    const active = createHarness();
    expect(active.controller.start()).toBe(true);
    FakeAudioNode.disconnectError = new Error('closed node');
    active.controller.cancel();
    expect(active.controller.isRunning()).toBe(false);

    const noAudio = createHarness();
    expect(noAudio.controller.start()).toBe(true);
    const staleCallback = FakeAudioContext.instances.at(-1)?.processor.onaudioprocess;
    noAudio.controller.pause();
    staleCallback?.({
      inputBuffer: {
        numberOfChannels: 1,
        sampleRate: VIDEO_AI_SAMPLE_RATE,
        getChannelData: () => new Float32Array([0]),
      },
    } as unknown as AudioProcessingEvent);
  });

  it('取消带有收尾计时器的识别会清除计时器', () => {
    const pending = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => pending.promise);
    expect(harness.controller.start()).toBe(true);
    const profile = getVideoAiStreamProfile('tiny');
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    harness.video.ended = true;
    harness.controller.end(false);
    harness.controller.cancel();
    vi.advanceTimersByTime(4_000);
    pending.resolve({ text: 'late result' });
    expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
  });

  it('结束后的迟到 finalize callback 遇到新 session 时被丢弃', () => {
    const pending = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => pending.promise);
    vi.stubGlobal('window', {
      AudioContext: FakeAudioContext,
      setTimeout,
      clearTimeout: vi.fn(),
    });
    expect(harness.controller.start()).toBe(true);
    const profile = getVideoAiStreamProfile('tiny');
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    harness.video.ended = true;
    harness.controller.end(false);
    harness.controller.cancel();
    vi.advanceTimersByTime(3_500);
    expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
    pending.resolve({ text: 'stale result' });
  });
});
