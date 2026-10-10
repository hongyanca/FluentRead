/**
 * @file src/features/video-subtitle/content/video-ai/capture.ts
 * 文件职责：驱动 X 视频实时 AI 字幕的 PCM 采集、滚动窗口提交与会话失效。
 * 主要内容：协调 AudioContext、暂停/seek/ratechange 生命周期、播放器时钟连续性和迟到识别结果，保留实际语言检测与推理诊断。
 * 模块边界：只管理实时捕获状态和音频窗口，不负责页面控件、字幕 DOM 或翻译缓存。
 */
import { getVideoLocalTranscriptionRequestTimeoutMs, normalizeVideoLocalTranscriptionModel, type VideoAiRecognitionMetadata } from '@/src/features/video-subtitle/transcription';
import {
  getVideoAiAdaptiveSubmitStepMs,
  getVideoAiStreamProfile,
  measureVideoAiSpeechActivity,
  VIDEO_AI_SAMPLE_RATE,
  VideoAiStreamingResampler,
} from './audioWindow';
import {
  VideoAiTranscriptStabilizer,
  type VideoAiStabilizedCue,
} from './streamingTranscript';

export interface VideoAiAudioChunk {
  /** 连续采集后的 16 kHz 单声道 PCM；不会再经过 WebM 编解码。 */
  pcm: Float32Array;
  /** 这段滚动窗口在播放器时间轴上的起点。 */
  startMs: number;
  /** 这段滚动窗口覆盖的播放器时间轴长度。 */
  durationMs: number;
  /** PCM 自身的墙钟时长，供诊断和非 1x 播放映射使用。 */
  audioDurationMs: number;
  playbackRate: number;
  sequence: number;
  sessionId: number;
}

export interface VideoAiTranscriptionSegment {
  startMs?: number;
  endMs?: number;
  text?: string;
}

export interface VideoAiTranscriptionResult extends VideoAiRecognitionMetadata {
  text?: string;
  segments?: VideoAiTranscriptionSegment[];
  /** 当 offscreen 正在处理另一条流时，旧请求被丢弃；这不是识别错误。 */
  skipped?: boolean;
  model?: string;
  backend?: 'webgpu' | 'wasm';
  gpuInfo?: string;
  decodeMs?: number;
  inferenceMs?: number;
  audioDurationMs?: number;
  threads?: number;
  dtype?: 'q4' | 'q8';
}

export interface VideoAiCaptureDiagnostic extends VideoAiTranscriptionResult {
  sessionId: number;
  sequence: number;
  capturedAudioMs: number;
  timelineDurationMs: number;
  windowStartMs: number;
  windowEndMs: number;
  submittedAtWallMs: number;
  completedAtWallMs: number;
  resultAvailableAtMs: number;
  emittedCueCount: number;
  /** 推理慢到超过 30 秒硬上限时无法保留的音频；正常应始终为 0。 */
  droppedAudioMs: number;
  realtimeFactor?: number;
  effectiveSubmitStepMs: number;
}

export interface VideoAiCaptureOptions {
  getVideo: () => HTMLVideoElement | null;
  getModel: () => unknown;
  isSupported: () => boolean;
  transcribe: (chunk: VideoAiAudioChunk) => Promise<VideoAiTranscriptionResult>;
  onCue: (cue: VideoAiStabilizedCue) => void;
  onReset: () => void;
  onError: (error: Error) => void;
  onStateChange: () => void;
  /** 采集图建立后立即并行预热同一 generation 的模型。 */
  onSessionStart?: (sessionId: number) => void;
  onDiagnostic?: (diagnostic: VideoAiCaptureDiagnostic) => void;
  onInvalidate?: (
    reason: 'cancel' | 'pause' | 'seek' | 'ratechange' | 'ended' | 'destroy' | 'error',
    sessionId: number,
  ) => void;
}

type CaptureStreamVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext;

const AUDIO_PROCESSOR_BUFFER_SIZE = 4_096;
// 短窗模式下暂停恢复仍需要覆盖上一条临时 cue 的前后文；只保留 1.2 秒
// 会让恢复窗口从句子中间开始，导致 “system. Few moments...” 这类断句。
const VIDEO_AI_TINY_PAUSE_CONTEXT_MS = 3_000;
const VIDEO_AI_BASE_PAUSE_CONTEXT_MS = 3_600;
const VIDEO_AI_FINAL_MIN_AUDIO_MS = 900;

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  return window.AudioContext
    || (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * X 视频本地 AI 字幕的流式采集控制器。
 *
 * 与离散 MediaRecorder 分片不同，这里持续保留一个有上限的 PCM 环形窗口。
 * Whisper 推理再慢，中间的语音也仍在下一次滚动窗口中；同一页面永远只有
 * 一个推理进行中。静音只做低成本能量检测，不会反复唤醒模型。
 */
export class VideoAiCaptureController {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentSinkNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private captureSourceStream: MediaStream | null = null;
  private captureVideo: HTMLVideoElement | null = null;
  private trackEndCleanups: Array<() => void> = [];
  private readonly stabilizer = new VideoAiTranscriptStabilizer();
  private readonly resampler = new VideoAiStreamingResampler();
  private audioBlocks: Float32Array[] = [];
  private bufferedSamples = 0;
  private totalCapturedSamples = 0;
  private lastSubmittedSample = 0;
  private speechDetectedSinceSubmit = false;
  private processing = false;
  private processingToken = 0;
  private sequence = 0;
  private session = 0;
  private captureEpoch = 0;
  private running = false;
  private requested = false;
  private error = '';
  private adaptiveSubmitStepMs = 0;
  private resumeTailPcm: Float32Array | null = null;
  private readonly emittedCueIds = new Map<string, string>();
  private finishingAtEnd = false;
  private clearCuesAfterEnd = false;
  private endFinalizationTimer: number | undefined;
  private timelineEndMs: number | null = null;

  constructor(private readonly options: VideoAiCaptureOptions) {}

  isRunning(): boolean {
    return this.running;
  }

  isRequested(): boolean {
    return this.requested;
  }

  getError(): string {
    return this.error;
  }

  /** 在视频暂停时记录用户意图，play 事件再真正创建采集图。 */
  request(): void {
    this.requested = true;
    this.error = '';
    this.notify();
  }

  /** 开始或恢复采集；恢复时可以保留已经稳定提交的 cue。 */
  start(clearExistingCues = true): boolean {
    if (this.running) return true;
    if (!this.options.isSupported()) return false;

    const video = this.options.getVideo() as CaptureStreamVideo | null;
    const captureStream = video?.captureStream;
    const legacyCaptureStream = video?.mozCaptureStream;
    const AudioContextClass = getAudioContextConstructor();
    if (!video || (!captureStream && !legacyCaptureStream) || !AudioContextClass) {
      this.failBeforeStart(new Error('当前浏览器无法捕获 X 视频音频，请使用桌面版 Edge 或 Chrome'));
      return false;
    }

    let createdStream: MediaStream | null = null;
    let createdSourceStream: MediaStream | null = null;
    let createdContext: AudioContext | null = null;
    try {
      const sourceStream = (captureStream || legacyCaptureStream)!.call(video);
      createdSourceStream = sourceStream;
      let audioTracks = sourceStream.getAudioTracks();
      const providedStream = video.srcObject as (MediaStream & {
        getAudioTracks?: () => MediaStreamTrack[];
      }) | null;
      if (audioTracks.length === 0 && providedStream && typeof providedStream.getAudioTracks === 'function') {
        // srcObject 属于页面播放器；只使用克隆，关闭 FluentRead 时绝不能
        // stop 页面自己的音轨。
        audioTracks = providedStream.getAudioTracks().map((track) => track.clone());
      }
      if (audioTracks.length === 0) throw new Error('当前 X 视频没有可捕获的音轨');

      const audioStream = new MediaStream(audioTracks);
      createdStream = audioStream;
      const context = new AudioContextClass({
        sampleRate: VIDEO_AI_SAMPLE_RATE,
        latencyHint: 'interactive',
      });
      createdContext = context;
      const source = context.createMediaStreamSource(audioStream);
      // ScriptProcessor 在 Chromium 扩展中仍是稳定的同步 PCM 后备路径；处理
      // 发生在内容页面，而昂贵的 ASR 始终留在独立 Worker。
      const processor = context.createScriptProcessor(AUDIO_PROCESSOR_BUFFER_SIZE, 1, 1);
      const silentSink = context.createGain();
      silentSink.gain.value = 0;
      source.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(context.destination);

      if (clearExistingCues) {
        this.stabilizer.reset();
        this.emittedCueIds.clear();
        this.options.onReset();
        this.resumeTailPcm = null;
      }
      const resumeTail = clearExistingCues ? null : this.resumeTailPcm;
      this.resumeTailPcm = null;
      this.resetAudioWindow(false);
      if (resumeTail?.length) {
        this.audioBlocks = [resumeTail];
        this.bufferedSamples = resumeTail.length;
        this.totalCapturedSamples = resumeTail.length;
        this.speechDetectedSinceSubmit = measureVideoAiSpeechActivity(resumeTail).active;
      }
      this.error = '';
      this.requested = true;
      if (this.session === 0) this.session = 1;
      const session = this.session;
      const epoch = ++this.captureEpoch;
      this.running = true;
      this.stream = audioStream;
      this.captureSourceStream = sourceStream;
      this.captureVideo = video;
      this.audioContext = context;
      this.sourceNode = source;
      this.processorNode = processor;
      this.silentSinkNode = silentSink;
      createdStream = null;
      createdSourceStream = null;
      createdContext = null;
      this.options.onSessionStart?.(session);

      processor.onaudioprocess = (event) => {
        if (!this.running || session !== this.session || epoch !== this.captureEpoch) return;
        const channels = Array.from(
          { length: event.inputBuffer.numberOfChannels },
          (_, channel) => event.inputBuffer.getChannelData(channel),
        );
        const pcm = this.resampler.process(channels, event.inputBuffer.sampleRate, VIDEO_AI_SAMPLE_RATE);
        if (pcm.length === 0) return;
        const currentTimeMs = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime * 1_000) : null;
        const playbackRate = finitePositive(video.playbackRate, 1);
        const blockTimelineMs = pcm.length * 1_000 / VIDEO_AI_SAMPLE_RATE * playbackRate;
        if (currentTimeMs !== null && this.timelineEndMs !== null
          && (currentTimeMs + 250 < this.timelineEndMs
            || currentTimeMs - this.timelineEndMs > Math.max(3_000, blockTimelineMs * 12))) {
          this.options.onInvalidate?.('seek', session);
          this.session += 1;
          this.invalidateProcessing();
          this.stabilizer.reset();
          this.emittedCueIds.clear();
          this.resetAudioWindow(true);
          this.options.onReset();
          this.notify();
          return;
        }
        this.timelineEndMs = currentTimeMs ?? ((this.timelineEndMs || 0) + blockTimelineMs);
        this.appendAudio(pcm);
        this.maybeSubmitLatestWindow();
      };

      const handleTrackEnded = () => {
        if (this.running && session === this.session && epoch === this.captureEpoch) {
          this.fail(new Error('X 视频音轨已结束，请重新请求 AI 字幕'));
        }
      };
      this.trackEndCleanups = audioTracks.map((track) => {
        track.addEventListener('ended', handleTrackEnded);
        return () => track.removeEventListener('ended', handleTrackEnded);
      });

      void context.resume().catch((resumeError) => {
        if (session === this.session && epoch === this.captureEpoch) {
          this.fail(toError(resumeError, '浏览器音频采集启动失败'));
        }
      });
      this.notify();
      return true;
    } catch (startError) {
      createdStream?.getTracks().forEach((track) => track.stop());
      createdSourceStream?.getTracks().forEach((track) => track.stop());
      if (createdContext && createdContext.state !== 'closed') {
        void createdContext.close().catch(() => undefined);
      }
      this.fail(toError(startError, '浏览器音频采集失败'));
      return false;
    }
  }

  /**
   * 暂停时立即终止当前 Whisper generation，保留用户请求状态和已经上屏的
   * cue。否则视频虽然暂停，Worker 仍会继续跑满 CPU，background 也会一直
   * 把本地模型锁给这个标签页。
   */
  pause(): void {
    if (!this.running) return;
    const pauseContextMs = normalizeVideoLocalTranscriptionModel(this.options.getModel()) !== 'tiny'
      ? VIDEO_AI_BASE_PAUSE_CONTEXT_MS
      : VIDEO_AI_TINY_PAUSE_CONTEXT_MS;
    const pauseContextSamples = Math.round(pauseContextMs * VIDEO_AI_SAMPLE_RATE / 1_000);
    this.resumeTailPcm = this.copyLatestSamples(pauseContextSamples);
    this.options.onInvalidate?.('pause', this.session);
    this.session += 1;
    // 暂停不是新的语音轨道：保留已提交/临时 cue 的稳定器状态，让恢复后
    // 的尾窗可以原位补全上一句；seek、倍速和新请求仍走完整 reset。
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
    this.notify();
  }

  /** 用户主动停止：使已经在 offscreen 中运行的旧结果失效。 */
  cancel(): void {
    this.clearEndFinalization();
    this.resumeTailPcm = null;
    this.options.onInvalidate?.('cancel', this.session);
    this.requested = false;
    this.session += 1;
    this.stabilizer.reset();
    this.emittedCueIds.clear();
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
    this.notify();
  }

  /** seek 后重建采集窗口，旧位置的推理结果不能写回新播放位置。 */
  resetAfterSeek(): void {
    if (!this.running && !this.requested) return;
    this.clearEndFinalization();
    this.options.onInvalidate?.('seek', this.session);
    this.resumeTailPcm = null;
    this.session += 1;
    this.stabilizer.reset();
    this.emittedCueIds.clear();
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
    this.options.onReset();
    this.notify();

  }

  /** seeked 后由接入层调用；seek 期间不猜测最终播放头。 */
  resumeAfterSeek(): boolean {
    const video = this.options.getVideo();
    if (!this.requested || this.running || !video || video.paused || video.ended) return false;
    return this.start(false);
  }

  /** 倍速变化时旧窗口内的 PCM 时长比例已经失效；保留历史 cue，只重建尾部。 */
  resetAfterPlaybackRateChange(): void {
    if (!this.running && !this.requested) return;
    this.clearEndFinalization();
    this.options.onInvalidate?.('ratechange', this.session);
    this.resumeTailPcm = null;
    const video = this.captureVideo || this.options.getVideo();
    const shouldResume = this.requested && Boolean(video && !video.paused && !video.ended);
    this.session += 1;
    this.stabilizer.reset();
    this.emittedCueIds.clear();
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
    this.notify();
    if (shouldResume) {
      window.setTimeout(() => {
        const currentVideo = this.captureVideo || this.options.getVideo();
        if (this.requested && !this.running && currentVideo && !currentVideo.paused && !currentVideo.ended) {
          this.start(false);
        }
      }, 0);
    }
  }

  /** 视频结束时停止采集；是否清掉 cue 由接入层决定。 */
  end(clearCues = true): void {
    if (!this.running && !this.requested) return;
    this.resumeTailPcm = null;
    this.clearCuesAfterEnd = clearCues;
    if (!this.processing) this.maybeSubmitLatestWindow(true);
    if (this.processing) {
      const session = this.session;
      this.finishingAtEnd = true;
      this.stopAudioGraph();
      const model = normalizeVideoLocalTranscriptionModel(this.options.getModel());
      const timeoutMs = model === 'small' ? getVideoLocalTranscriptionRequestTimeoutMs(model)
        : model === 'base' ? 5_000 : 3_500;
      this.endFinalizationTimer = window.setTimeout(() => {
        this.finalizeEndedSession(session);
      }, timeoutMs);
      this.notify();
      return;
    }
    this.finalizeEndedSession(this.session);
  }

  private finalizeEndedSession(session: number): void {
    if (session !== this.session) return;
    if (this.endFinalizationTimer !== undefined) {
      window.clearTimeout(this.endFinalizationTimer);
      this.endFinalizationTimer = undefined;
    }
    this.finishingAtEnd = false;
    const video = this.options.getVideo();
    const availableAtMs = video && Number.isFinite(video.currentTime)
      ? Math.max(0, video.currentTime * 1_000)
      : 0;
    this.emitCues(this.stabilizer.flush(availableAtMs), session);
    this.options.onInvalidate?.('ended', this.session);
    this.session += 1;
    this.stabilizer.reset();
    this.emittedCueIds.clear();
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
    if (this.clearCuesAfterEnd) this.options.onReset();
    this.clearCuesAfterEnd = false;
    this.notify();
  }

  destroy(): void {
    this.clearEndFinalization();
    this.resumeTailPcm = null;
    this.options.onInvalidate?.('destroy', this.session);
    this.requested = false;
    this.session += 1;
    this.stabilizer.reset();
    this.emittedCueIds.clear();
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
  }

  private resetAudioWindow(resetSequence: boolean): void {
    this.resampler.reset();
    this.audioBlocks = [];
    this.bufferedSamples = 0;
    this.totalCapturedSamples = 0;
    this.lastSubmittedSample = 0;
    this.speechDetectedSinceSubmit = false;
    this.timelineEndMs = null;
    if (resetSequence) {
      this.adaptiveSubmitStepMs = 0;
      this.sequence = 0;
    }
  }

  private appendAudio(pcm: Float32Array): void {
    // Web Audio 会复用 inputBuffer；保留独立数组，避免下一次回调改写窗口。
    const block = pcm.slice();
    this.audioBlocks.push(block);
    this.bufferedSamples += block.length;
    this.totalCapturedSamples += block.length;
    // 只扫描本次约 256ms 的新 PCM，而不是静音时每 420ms 复制并扫描完整
    // 30 秒窗口。检测结果一直保留到下一次提交，不会漏掉“说完后停顿”。
    if (!this.speechDetectedSinceSubmit && measureVideoAiSpeechActivity(block).active) {
      this.speechDetectedSinceSubmit = true;
    }

    const profile = getVideoAiStreamProfile(this.options.getModel());
    const maxSamples = Math.max(1, Math.round(profile.maxBufferedMs * VIDEO_AI_SAMPLE_RATE / 1000));
    while (this.bufferedSamples > maxSamples && this.audioBlocks.length > 0) {
      const overflow = this.bufferedSamples - maxSamples;
      const first = this.audioBlocks[0];
      if (first.length <= overflow) {
        this.audioBlocks.shift();
        this.bufferedSamples -= first.length;
      } else {
        this.audioBlocks[0] = first.slice(overflow);
        this.bufferedSamples -= overflow;
      }
    }
  }

  private copyLatestSamples(sampleCount: number): Float32Array {
    const count = Math.max(0, Math.min(this.bufferedSamples, Math.floor(sampleCount)));
    if (count === 0) return new Float32Array();
    const output = new Float32Array(count);
    let writeAt = count;
    for (let index = this.audioBlocks.length - 1; index >= 0 && writeAt > 0; index -= 1) {
      const block = this.audioBlocks[index];
      const take = Math.min(writeAt, block.length);
      writeAt -= take;
      output.set(block.subarray(block.length - take), writeAt);
    }
    return output;
  }

  private maybeSubmitLatestWindow(force = false): boolean {
    if (!this.running || this.processing) return false;
    const profile = getVideoAiStreamProfile(this.options.getModel());
    const capturedSinceSubmit = this.totalCapturedSamples - this.lastSubmittedSample;
    const effectiveSubmitStepMs = this.adaptiveSubmitStepMs || profile.submitStepMs;
    const requiredMs = this.lastSubmittedSample === 0 ? profile.initialWindowMs : effectiveSubmitStepMs;
    const requiredSamples = Math.max(1, Math.round(requiredMs * VIDEO_AI_SAMPLE_RATE / 1000));
    const finalMinimumSamples = Math.round(VIDEO_AI_FINAL_MIN_AUDIO_MS * VIDEO_AI_SAMPLE_RATE / 1_000);
    if (capturedSinceSubmit < (force ? finalMinimumSamples : requiredSamples)) return false;

    if (!this.speechDetectedSinceSubmit) {
      // 静音不会进入 Whisper，也不会在每个 Web Audio 回调重复检查同一段历史。
      this.lastSubmittedSample = this.totalCapturedSamples;
      return false;
    }

    const overlapSamples = this.lastSubmittedSample === 0
      ? 0
      : Math.round(800 * VIDEO_AI_SAMPLE_RATE / 1000);
    const requestedWindowSamples = Math.max(
      Math.round(profile.targetWindowMs * VIDEO_AI_SAMPLE_RATE / 1000),
      capturedSinceSubmit + overlapSamples,
    );
    const targetSamples = Math.min(
      this.bufferedSamples,
      Math.max(1, Math.min(
        requestedWindowSamples,
        Math.round(profile.maxBufferedMs * VIDEO_AI_SAMPLE_RATE / 1000),
      )),
    );
    const droppedAudioMs = Math.max(0, capturedSinceSubmit + overlapSamples - this.bufferedSamples)
      * 1000 / VIDEO_AI_SAMPLE_RATE;

    const pcm = this.copyLatestSamples(targetSamples);
    // running 状态只会在建图成功后出现；此时 captureVideo 和目标窗口均已存在。
    const video = this.captureVideo!;
    const playbackRate = finitePositive(video.playbackRate, 1);
    const audioDurationMs = pcm.length * 1000 / VIDEO_AI_SAMPLE_RATE;
    const durationMs = audioDurationMs * playbackRate;
    const endMs = Number.isFinite(video.currentTime)
      ? Math.max(0, video.currentTime * 1000)
      : durationMs;
    const chunk: VideoAiAudioChunk = {
      pcm,
      startMs: Math.max(0, endMs - durationMs),
      durationMs,
      audioDurationMs,
      playbackRate,
      sequence: ++this.sequence,
      sessionId: this.session,
    };
    const session = this.session;
    const processingToken = ++this.processingToken;
    const submittedAtWallMs = performance.now();
    this.lastSubmittedSample = this.totalCapturedSamples;
    this.speechDetectedSinceSubmit = false;
    this.processing = true;

    void this.options.transcribe(chunk)
      .then((result) => {
        if (session !== this.session) return;
        const currentVideo = this.captureVideo || this.options.getVideo();
        const availableAtMs = currentVideo && Number.isFinite(currentVideo.currentTime)
          ? Math.max(0, currentVideo.currentTime * 1000)
          : chunk.startMs + chunk.durationMs;
        const completedAtWallMs = performance.now();
        if (result.skipped) {
          this.options.onDiagnostic?.({
            ...result,
            sessionId: session,
            sequence: chunk.sequence,
            capturedAudioMs: chunk.audioDurationMs,
            timelineDurationMs: chunk.durationMs,
            windowStartMs: chunk.startMs,
            windowEndMs: chunk.startMs + chunk.durationMs,
            submittedAtWallMs,
            completedAtWallMs,
            resultAvailableAtMs: availableAtMs,
            emittedCueCount: 0,
            droppedAudioMs,
            effectiveSubmitStepMs,
          });
          return;
        }
        const scaledSegments = Array.isArray(result.segments)
          ? result.segments.map((segment) => ({
              ...segment,
              startMs: typeof segment.startMs === 'number' ? segment.startMs * chunk.playbackRate : undefined,
              endMs: typeof segment.endMs === 'number' ? segment.endMs * chunk.playbackRate : undefined,
            }))
          : [];
        const cues = this.stabilizer.ingest({
          startMs: chunk.startMs,
          durationMs: chunk.durationMs,
          availableAtMs,
          text: result.text,
          segments: scaledSegments,
        });
        this.emitCues(cues, session);
        if (typeof result.inferenceMs === 'number') {
          const nextStep = getVideoAiAdaptiveSubmitStepMs(
            normalizeVideoLocalTranscriptionModel(this.options.getModel()),
            result.inferenceMs,
            profile,
          );
          this.adaptiveSubmitStepMs = this.adaptiveSubmitStepMs > 0
            ? this.adaptiveSubmitStepMs * 0.6 + nextStep * 0.4
            : nextStep;
        }
        this.options.onDiagnostic?.({
          ...result,
          sessionId: session,
          sequence: chunk.sequence,
          capturedAudioMs: chunk.audioDurationMs,
          timelineDurationMs: chunk.durationMs,
          windowStartMs: chunk.startMs,
          windowEndMs: chunk.startMs + chunk.durationMs,
          submittedAtWallMs,
          completedAtWallMs,
          resultAvailableAtMs: availableAtMs,
          emittedCueCount: cues.length,
          droppedAudioMs,
          effectiveSubmitStepMs: this.adaptiveSubmitStepMs || effectiveSubmitStepMs,
          realtimeFactor: typeof result.inferenceMs === 'number' && chunk.audioDurationMs > 0
            ? result.inferenceMs / chunk.audioDurationMs
            : undefined,
        });
      })
      .catch((transcriptionError) => {
        if (session === this.session && !this.finishingAtEnd) {
          this.fail(toError(transcriptionError, '本地视频 AI 字幕失败'));
        }
      })
      .finally(() => {
        if (processingToken !== this.processingToken) return;
        this.processing = false;
        if (this.finishingAtEnd) {
          this.finalizeEndedSession(session);
          return;
        }
        // 推理期间捕获的全部 PCM 仍在有限窗口中；立即用最新窗口追赶。
        this.maybeSubmitLatestWindow();
      });
    return true;
  }

  private emitCues(cues: VideoAiStabilizedCue[], session: number): void {
    cues.forEach((cue) => {
      let emittedCueId: string | undefined;
      if (cue.cueId) {
        emittedCueId = this.emittedCueIds.get(cue.cueId);
        if (!emittedCueId) {
          emittedCueId = `session-${session}:${cue.cueId}`;
          this.emittedCueIds.set(cue.cueId, emittedCueId);
          if (this.emittedCueIds.size > 128) {
            const oldestCueId = this.emittedCueIds.keys().next().value;
            if (oldestCueId) this.emittedCueIds.delete(oldestCueId);
          }
        }
      }
      this.options.onCue({
        ...cue,
        // generation 仍然校验旧 Promise；暂停恢复时，同一条临时 cue 复用
        // 已发出的身份，避免原位更新被统计/翻译层误当成第二条字幕。
        cueId: emittedCueId,
      });
    });
  }

  private clearEndFinalization(): void {
    if (this.endFinalizationTimer !== undefined) {
      window.clearTimeout(this.endFinalizationTimer);
      this.endFinalizationTimer = undefined;
    }
    this.finishingAtEnd = false;
    this.clearCuesAfterEnd = false;
  }

  private stopAudioGraph(): void {
    this.running = false;
    this.captureEpoch += 1;
    this.trackEndCleanups.forEach((cleanup) => cleanup());
    this.trackEndCleanups = [];
    if (this.processorNode) this.processorNode.onaudioprocess = null;
    try { this.sourceNode?.disconnect(); } catch { /* 节点可能已经被浏览器关闭。 */ }
    try { this.processorNode?.disconnect(); } catch { /* 节点可能已经被浏览器关闭。 */ }
    try { this.silentSinkNode?.disconnect(); } catch { /* 节点可能已经被浏览器关闭。 */ }
    this.sourceNode = null;
    this.processorNode = null;
    this.silentSinkNode = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.captureSourceStream?.getTracks().forEach((track) => track.stop());
    this.captureSourceStream = null;
    this.captureVideo = null;
    this.audioBlocks = [];
    this.bufferedSamples = 0;
  }

  private invalidateProcessing(): void {
    this.processingToken += 1;
    this.processing = false;
  }

  private failBeforeStart(error: Error): void {
    this.resumeTailPcm = null;
    this.error = error.message;
    this.requested = false;
    this.options.onError(error);
    this.notify();
  }

  private fail(error: Error): void {
    this.resumeTailPcm = null;
    this.error = error.message;
    this.options.onError(error);
    this.options.onInvalidate?.('error', this.session);
    this.requested = false;
    this.session += 1;
    this.stabilizer.reset();
    this.emittedCueIds.clear();
    this.invalidateProcessing();
    this.resetAudioWindow(true);
    this.stopAudioGraph();
    this.notify();
  }

  private notify(): void {
    this.options.onStateChange();
  }
}
