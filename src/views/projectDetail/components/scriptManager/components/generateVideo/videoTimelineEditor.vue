<template>
  <a-modal
    v-model:open="showModal"
    :footer="false"
    :width="modalWidth"
    :style="modalStyle"
    :bodyStyle="modalBodyStyle"
    wrapClassName="timelineEditorModal"
    :maskClosable="false">
    <template #title>
      <div class="timelineHeader">
        <div class="title">
          <i-video-two :size="20" />
          <span>时间轴编辑器</span>
        </div>
        <div class="actions">
          <a-button size="small" @click="toggleModalExpanded">{{ isModalExpanded ? "还原" : "放大" }}</a-button>
          <a-button size="small" @click="refreshData">刷新</a-button>
          <a-button size="small" type="primary" :loading="savingOrder" @click="saveOrder">保存排序</a-button>
        </div>
      </div>
    </template>

    <div class="timelineBody" ref="timelineRootRef" :class="{ fullscreen: isEditorFullscreen }">
      <div class="editorFloatingActions">
        <a-button size="small" @click="toggleInspectorPanel">{{ showInspectorPanel ? "隐藏侧栏(Tab)" : "显示侧栏(Tab)" }}</a-button>
        <a-button size="small" type="primary" @click="toggleEditorFullscreen">{{ isEditorFullscreen ? "退出全屏" : "全屏编辑" }}</a-button>
      </div>
      <div class="timelineBodyContent" :class="{ noInspector: !showInspectorPanel }">
        <div class="timelineMain">
          <div class="previewPanel">
            <div class="previewHeader">
              <div class="previewTitle">全轨道预览</div>
            </div>
            <div class="previewVideo" ref="previewPanelRef">
              <video ref="previewVideoRef" class="videoPlayer" @ended="handlePreviewEnded" />
              <div class="globalProgress" @mousedown.prevent="handleGlobalSeek">
                <div class="globalProgressBar">
                  <div class="globalProgressFill" :style="{ width: `${globalProgressPercent}%` }" />
                  <div class="globalProgressHandle" :style="{ left: `${globalProgressPercent}%` }" />
                </div>
              </div>
            </div>
            <div class="previewActionBar">
              <div class="previewActionLeft">
                <span class="previewTimeCurrent">{{ formatSeconds(playheadSeconds) }}</span>
                <span class="previewTimeDivider">/</span>
                <span class="previewTimeTotal">{{ formatSeconds(totalDuration) }}</span>
              </div>
              <div class="previewActionCenter">
                <a-button class="transportBtn" type="primary" @click="togglePreviewPlayback" :disabled="!timelineClips.length">
                  {{ previewPlaying ? "暂停" : "播放" }}
                </a-button>
              </div>
              <div class="previewActionRight">
                <div class="zoomControl">
                  <button class="zoomBtn" type="button" :disabled="!canZoomOut" @click="zoomOutTimeline">-</button>
                  <button class="zoomReset" type="button" @click="resetTimelineZoom">{{ zoomPercent }}%</button>
                  <button class="zoomBtn" type="button" :disabled="!canZoomIn" @click="zoomInTimeline">+</button>
                </div>
                <a-button size="small" @click="togglePreviewFullscreen">{{ isPreviewFullscreen ? "退出预览全屏" : "预览全屏" }}</a-button>
              </div>
            </div>
          </div>

          <div class="timelineScroller" ref="scrollerRef" @mousedown="handleTimelineMouseDown" @wheel="handleTimelineWheel">
            <div class="timelineContent" :style="{ width: `${timelineWidth}px` }">
              <div class="ruler">
                <div
                  v-for="tick in rulerTicks"
                  :key="`tick-${tick}`"
                  class="rulerTick"
                  :class="{ major: isMajorTick(tick), anchor: isAnchorTick(tick) }"
                  :style="{ left: `${TRACK_LABEL_WIDTH + tick * pixelsPerSecond}px` }">
                  <span v-if="isAnchorTick(tick)">{{ tick }}s</span>
                </div>
              </div>
              <div class="playhead" :style="{ left: `${playheadX}px` }">
                <div class="playheadTime">{{ formatSeconds(playheadSeconds) }}</div>
                <div class="playheadHandle" />
              </div>

              <div class="trackGroup">
                <div class="groupHeader">
                  <span>视频轨道</span>
                  <button class="trackToggle" @click.stop="toggleTrack('video', 1)">{{ isTrackVisible("video", 1) ? "隐藏" : "显示" }}</button>
                  <button class="trackToggle" @click.stop="toggleMute('video', 1)">{{ isTrackMuted("video", 1) ? "取消静音" : "静音" }}</button>
                </div>
                <div class="trackLane">
                  <div class="trackLabel">视频</div>
                  <div class="laneContent laneVideo" v-show="isTrackVisible('video', 1)">
                    <div
                      v-for="clip in timelineClips"
                      :key="`video-${clip.config.id}`"
                      class="clipItem video"
                      :class="{ active: activeConfigId === clip.config.id, muted: isTrackMuted('video', 1) }"
                      :style="{ left: `${clip.start * pixelsPerSecond}px`, width: `${clip.duration * pixelsPerSecond}px` }"
                      @click.stop="selectConfig(clip.config)">
                      <img v-if="clip.result?.firstFrame" :src="clip.result.firstFrame" />
                      <div v-else class="clipPlaceholder">视频</div>
                      <div class="clipMeta">#{{ clip.index + 1 }} · {{ clip.duration }}s</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="trackGroup">
                <div class="groupHeader">
                  <span>音频轨道</span>
                  <a-button size="small" @click="addAudioTrack">新增音频轨</a-button>
                </div>
                <div v-for="lane in audioTrackCount" :key="`audio-track-${lane}`" class="trackLane">
                  <div class="trackLabel">
                    <span>音频轨 {{ lane }}</span>
                    <button class="trackToggle" @click.stop="toggleTrack('audio', lane)">
                      {{ isTrackVisible("audio", lane) ? "隐藏" : "显示" }}
                    </button>
                    <button class="trackToggle" @click.stop="toggleMute('audio', lane)">
                      {{ isTrackMuted("audio", lane) ? "取消静音" : "静音" }}
                    </button>
                  </div>
                  <div class="laneContent laneAudio" v-show="isTrackVisible('audio', lane)">
                    <div
                      v-for="clip in audioClipsByTrack(lane)"
                      :key="`audio-${clip.config.id}`"
                      class="clipItem audio"
                      :class="{ active: activeConfigId === clip.config.id, muted: isTrackMuted('audio', lane) }"
                      :style="{ left: `${clip.start * pixelsPerSecond}px`, width: `${clip.duration * pixelsPerSecond}px` }"
                      @click.stop="selectConfig(clip.config)">
                      <div class="waveform">
                        <svg v-if="getWaveform(clip.config.audioPath || clip.config.ttsAudioPath)" viewBox="0 0 100 40" preserveAspectRatio="none">
                          <rect
                            v-for="(amp, idx) in getWaveform(clip.config.audioPath || clip.config.ttsAudioPath)"
                            :key="`aw-${clip.config.id}-${idx}`"
                            :x="idx * (100 / waveformBucketCount)"
                            :y="40 - amp * 40"
                            :width="100 / waveformBucketCount - 0.5"
                            :height="amp * 40"
                            rx="1"
                            ry="1" />
                        </svg>
                        <div v-else class="waveformPlaceholder" />
                      </div>
                      <div class="clipMeta">音频 · {{ clip.duration }}s</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="trackGroup">
                <div class="groupHeader">
                  <span>台词轨道</span>
                  <a-button size="small" @click="addDialogueTrack">新增台词轨</a-button>
                </div>
                <div v-for="lane in dialogueTrackCount" :key="`dialogue-track-${lane}`" class="trackLane">
                  <div class="trackLabel">
                    <span>台词轨 {{ lane }}</span>
                    <button class="trackToggle" @click.stop="toggleTrack('dialogue', lane)">
                      {{ isTrackVisible("dialogue", lane) ? "隐藏" : "显示" }}
                    </button>
                    <button class="trackToggle" @click.stop="toggleMute('dialogue', lane)">
                      {{ isTrackMuted("dialogue", lane) ? "取消静音" : "静音" }}
                    </button>
                  </div>
                  <div class="laneContent laneDialogue" v-show="isTrackVisible('dialogue', lane)">
                    <div
                      v-for="clip in dialogueClipsByTrack(lane)"
                      :key="`dialogue-${clip.config.id}`"
                      class="clipItem dialogue"
                      :class="{ active: activeConfigId === clip.config.id, muted: isTrackMuted('dialogue', lane) }"
                      :style="{ left: `${clip.start * pixelsPerSecond}px`, width: `${clip.duration * pixelsPerSecond}px` }"
                      @click.stop="selectConfig(clip.config)">
                      <div class="waveform">
                        <svg v-if="getWaveform(clip.config.ttsAudioPath || clip.config.audioPath)" viewBox="0 0 100 40" preserveAspectRatio="none">
                          <rect
                            v-for="(amp, idx) in getWaveform(clip.config.ttsAudioPath || clip.config.audioPath)"
                            :key="`dw-${clip.config.id}-${idx}`"
                            :x="idx * (100 / waveformBucketCount)"
                            :y="40 - amp * 40"
                            :width="100 / waveformBucketCount - 0.5"
                            :height="amp * 40"
                            rx="1"
                            ry="1" />
                        </svg>
                        <div v-else class="waveformPlaceholder" />
                      </div>
                      <div class="clipMeta">台词 · {{ clip.duration }}s</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="timelineInspector" v-if="showInspectorPanel">
          <template v-if="activeConfig">
            <div class="inspectorTitle">片段设置</div>
            <div class="inspectorSegmentTabs">
              <button class="inspectorSegmentBtn" :class="{ active: activeInspectorSection === 'clip' }" @click="setInspectorSection('clip')">
                片段
              </button>
              <button class="inspectorSegmentBtn" :class="{ active: activeInspectorSection === 'audio' }" @click="setInspectorSection('audio')">
                音频
              </button>
              <button class="inspectorSegmentBtn" :class="{ active: activeInspectorSection === 'dialogue' }" @click="setInspectorSection('dialogue')">
                台词
              </button>
            </div>

            <div class="inspectorPanel" v-show="activeInspectorSection === 'clip'">
              <div class="inspectorSection">
                <div class="inspectorLabel">视频操作</div>
                <div class="inspectorRow">
                  <a-button size="small" @click="openVideoDetail">进入生成详情</a-button>
                  <a-button size="small" @click="refreshConfigStatus">刷新生成状态</a-button>
                </div>
              </div>

              <div class="inspectorSection">
                <div class="inspectorLabel">分镜图重生成</div>
                <div class="inspectorRow">
                  <a-select
                    v-if="activeStoryboardCandidates.length > 1"
                    v-model:value="selectedStoryboardShotId"
                    placeholder="选择分镜"
                    style="width: 180px">
                    <a-select-option v-for="shot in activeStoryboardCandidates" :key="`shot-opt-${shot.id}`" :value="shot.id">
                      {{ storyboardOptionLabel(shot) }}
                    </a-select-option>
                  </a-select>
                  <a-popconfirm title="确认重生成当前分镜吗？" ok-text="确认" cancel-text="取消" @confirm="regenerateStoryboardForActiveConfig">
                    <a-button size="small" :loading="storyboardRegenerating" :disabled="!activeStoryboardCandidates.length">重生成分镜</a-button>
                  </a-popconfirm>
                  <a-button size="small" :loading="storyboardLoading" @click="fetchStoryboardShots">刷新分镜</a-button>
                </div>
                <div v-if="!activeStoryboardCandidates.length" class="inspectorTip">当前片段未关联分镜图</div>
              </div>

              <div class="inspectorSection">
                <div class="inspectorLabel">轨道分配</div>
                <div class="inspectorRow">
                  <a-select v-model:value="selectedAudioTrack" placeholder="音频轨" style="width: 120px" @change="updateAudioTrack">
                    <a-select-option v-for="lane in audioTrackCount" :key="`audio-opt-${lane}`" :value="lane">音频轨 {{ lane }}</a-select-option>
                  </a-select>
                  <a-select v-model:value="selectedDialogueTrack" placeholder="台词轨" style="width: 120px" @change="updateDialogueTrack">
                    <a-select-option v-for="lane in dialogueTrackCount" :key="`dialogue-opt-${lane}`" :value="lane">
                      台词轨 {{ lane }}
                    </a-select-option>
                  </a-select>
                </div>
              </div>
            </div>

            <div class="inspectorPanel" v-show="activeInspectorSection === 'audio'">
              <div class="inspectorSection">
                <div class="inspectorLabel">多音频切换</div>
                <div class="inspectorRow">
                  <a-select
                    v-model:value="selectedAudioVariantKey"
                    placeholder="选择音频版本"
                    style="width: 220px"
                    :disabled="activeAudioVariants.length === 0">
                    <a-select-option v-for="item in activeAudioVariants" :key="`audio-variant-${item.key}`" :value="item.key">
                      {{ item.label }}
                    </a-select-option>
                  </a-select>
                  <a-button size="small" :disabled="!selectedAudioVariantKey" @click="applySelectedAudioVariant">设为主音频</a-button>
                </div>
                <div v-if="activeAudioVariants.length === 0" class="inspectorTip">当前片段暂无可切换音频</div>
                <div v-else class="inspectorTip">当前主音频：{{ currentAudioVariantLabel }}</div>
              </div>

              <div class="inspectorSection">
                <div class="inspectorLabel">音频轨道</div>
                <div class="inspectorRow">
                  <input ref="audioFileInput" type="file" accept="audio/*" class="hiddenFile" @change="handleAudioFileChange" />
                  <a-button size="small" @click="triggerAudioFile">上传音频</a-button>
                  <a-popconfirm title="确认清除当前片段音频吗？" ok-text="确认" cancel-text="取消" @confirm="clearAudio">
                    <a-button size="small" danger>清除音频</a-button>
                  </a-popconfirm>
                </div>
                <audio v-if="activeAudioUrl" :src="activeAudioUrl" controls class="audioPlayer" />
              </div>
            </div>

            <div class="inspectorPanel" v-show="activeInspectorSection === 'dialogue'">
              <div class="inspectorSection">
                <div class="inspectorLabel">台词内容</div>
                <a-textarea v-model:value="editableDialogue" :rows="5" placeholder="输入台词内容..." />
              </div>

              <div class="inspectorSection">
                <div class="inspectorLabel">音色选择</div>
                <div class="inspectorRow">
                  <a-select v-model:value="selectedVoiceConfigId" placeholder="选择语音模型" style="width: 180px" @change="handleVoiceConfigChange">
                    <a-select-option v-for="item in voiceModels" :key="item.id" :value="item.id">
                      {{ item.model }} ({{ item.manufacturer }})
                    </a-select-option>
                  </a-select>
                  <a-select v-model:value="selectedVoicePresetId" placeholder="选择音色" style="width: 180px">
                    <a-select-option v-for="item in voicePresets" :key="item.voiceId" :value="item.voiceId">
                      {{ item.name }}
                    </a-select-option>
                  </a-select>
                </div>
                <div class="inspectorRow">
                  <a-button size="small" :loading="dialogueGenerating" @click="generateDialogueAudio">生成台词音频</a-button>
                  <a-button size="small" @click="saveDialogue">保存台词</a-button>
                </div>
              </div>
            </div>
          </template>

          <div v-else class="inspectorEmpty">请先在时间轴选择片段</div>
        </div>
      </div>
    </div>

    <videoDetail v-if="detailModalShow" v-model="detailModalShow" :configId="activeConfigId" />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import { message } from "ant-design-vue";
import axios from "@/utils/axios";
import videoStore, { type VideoConfig, type VideoResult } from "@/stores/video";
import videoDetail from "./videoDetail.vue";

type VoicePresetApiItem =
  | string
  | {
      voice_id?: unknown;
      voiceId?: unknown;
      id?: unknown;
      key?: unknown;
      name?: unknown;
      label?: unknown;
      voice_name?: unknown;
    };

type StoryboardShot = {
  id: number;
  segmentId?: number;
  shotIndex?: number;
  name?: string;
  intro?: string;
  prompt?: string;
  filePath?: string;
  x?: number;
  y?: number;
  cells?: Array<{ id?: string; src?: string; prompt?: string }>;
  assetsTags?: Array<{ type?: string; text?: string }>;
};

type AudioVariant = {
  key: string;
  label: string;
  source: "video" | "external";
  url: string;
  persistable: boolean;
};
type InspectorSection = "clip" | "audio" | "dialogue";

const showModal = defineModel<boolean>({ default: false });
const props = defineProps<{
  scriptId: number | null;
  projectId: number | null;
}>();

const store = videoStore();
const { currentConfigs } = storeToRefs(store);

const previewVideoRef = ref<HTMLVideoElement | null>(null);
const previewPanelRef = ref<HTMLDivElement | null>(null);
const timelineRootRef = ref<HTMLDivElement | null>(null);
const previewAudioRef = ref<HTMLAudioElement | null>(null);
const previewDialogueRef = ref<HTMLAudioElement | null>(null);
const scrollerRef = ref<HTMLDivElement | null>(null);
const detailModalShow = ref(false);
const activeConfigId = ref<number | null>(null);
const savingOrder = ref(false);
const dialogueGenerating = ref(false);
const voiceModels = ref<{ id: number; model: string; manufacturer: string }[]>([]);
const voicePresets = ref<{ voiceId: string; name: string }[]>([]);
const selectedVoiceConfigId = ref<number | null>(null);
const selectedVoicePresetId = ref<string>("");
const editableDialogue = ref("");
const selectedAudioTrack = ref(1);
const selectedDialogueTrack = ref(1);
const audioFileInput = ref<HTMLInputElement | null>(null);
const waveformCache = ref(new Map<string, number[]>());
const waveformLoading = ref(new Set<string>());
const waveformBucketCount = 48;
const storyboardShots = ref<StoryboardShot[]>([]);
const storyboardLoading = ref(false);
const storyboardRegenerating = ref(false);
const selectedStoryboardShotId = ref<number | null>(null);
const selectedAudioVariantKey = ref("");
const audioVariantOverrides = ref<Record<number, { source: "video" | "external"; url: string }>>({});
const audioHistoryByConfig = ref<Record<number, string[]>>({});

const audioTrackOverride = ref<number | null>(null);
const dialogueTrackOverride = ref<number | null>(null);
const isEditorFullscreen = ref(false);
const isModalExpanded = ref(false);
const isPreviewFullscreen = ref(false);
const inspectorPanelVisible = ref(true);
const activeInspectorSection = ref<InspectorSection>("clip");

const trackStates = ref<Record<string, { muted: boolean; visible: boolean }>>({});

const TRACK_LABEL_WIDTH = 100;
const ZOOM_LEVELS = [40, 50, 60, 80, 100, 120, 150, 180];
const DEFAULT_PIXELS_PER_SECOND = 60;
const defaultZoomIndex = Math.max(0, ZOOM_LEVELS.indexOf(DEFAULT_PIXELS_PER_SECOND));
const zoomIndex = ref(defaultZoomIndex);
const AUX_DRIFT_THRESHOLD = 0.12;
const modalWidth = computed(() => (isModalExpanded.value ? "96vw" : 1280));
const modalStyle = computed(() => ({
  top: isModalExpanded.value ? "2vh" : "60px",
}));
const modalBodyStyle = computed(() => ({
  height: isModalExpanded.value ? "88vh" : "72vh",
  overflow: "hidden",
}));

const orderedConfigs = computed(() => {
  const list = [...currentConfigs.value];
  list.sort((a, b) => {
    const sa = Number.isFinite(Number(a.sort)) ? Number(a.sort) : Number.MAX_SAFE_INTEGER;
    const sb = Number.isFinite(Number(b.sort)) ? Number(b.sort) : Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.id - b.id;
  });
  return list;
});

const timelineClips = computed(() => {
  const clips: Array<{ config: VideoConfig; result: VideoResult | null; start: number; duration: number; index: number }> = [];
  let cursor = 0;
  orderedConfigs.value.forEach((config, index) => {
    const duration = Number(config.duration || 5);
    const result = store.getSelectedResult(config.id);
    clips.push({ config, result, start: cursor, duration, index });
    cursor += duration;
  });
  return clips;
});

const totalDuration = computed(() => {
  if (!timelineClips.value.length) return 0;
  const last = timelineClips.value[timelineClips.value.length - 1];
  return last.start + last.duration;
});

const pixelsPerSecond = computed(() => ZOOM_LEVELS[zoomIndex.value] || DEFAULT_PIXELS_PER_SECOND);
const zoomPercent = computed(() => Math.round((pixelsPerSecond.value / DEFAULT_PIXELS_PER_SECOND) * 100));
const canZoomIn = computed(() => zoomIndex.value < ZOOM_LEVELS.length - 1);
const canZoomOut = computed(() => zoomIndex.value > 0);
const timelineWidth = computed(() => Math.max(totalDuration.value * pixelsPerSecond.value + 200, 800));

const playheadSeconds = ref(0);
const playheadX = computed(() => TRACK_LABEL_WIDTH + playheadSeconds.value * pixelsPerSecond.value);
const previewPlaying = ref(false);
const previewIndex = ref<number | null>(null);
const globalProgressPercent = computed(() => {
  if (!totalDuration.value) return 0;
  return Math.min(100, Math.max(0, (playheadSeconds.value / totalDuration.value) * 100));
});

const audioTrackCount = computed(() => {
  const derived = Math.max(1, ...orderedConfigs.value.map((item) => Number(item.audioTrack || 1)));
  return Math.max(derived, audioTrackOverride.value || 0);
});
const dialogueTrackCount = computed(() => {
  const derived = Math.max(1, ...orderedConfigs.value.map((item) => Number(item.dialogueTrack || 1)));
  return Math.max(derived, dialogueTrackOverride.value || 0);
});

const rulerTicks = computed(() => {
  const total = Math.ceil(totalDuration.value * 2);
  return Array.from({ length: total + 1 }, (_, idx) => idx / 2);
});

const activeConfig = computed(() => orderedConfigs.value.find((item) => item.id === activeConfigId.value) || null);
const activeAudioUrl = computed(() => {
  if (!activeConfig.value) return "";
  const source = getAudioPlaybackSource(activeConfig.value);
  return source.source === "external" ? source.url : "";
});
const activeStoryboardCandidates = computed(() => {
  if (!activeConfig.value) return [];
  return getStoryboardCandidates(activeConfig.value);
});
const activeAudioVariants = computed(() => {
  if (!activeConfig.value) return [];
  return buildAudioVariants(activeConfig.value);
});
const currentAudioVariantLabel = computed(() => {
  const current = activeAudioVariants.value.find((item) => item.key === selectedAudioVariantKey.value);
  return current?.label || "未设置";
});
const showInspectorPanel = computed(() => inspectorPanelVisible.value);

watch(
  () => showModal.value,
  (val) => {
    if (val) {
      inspectorPanelVisible.value = true;
      activeInspectorSection.value = "clip";
      zoomIndex.value = defaultZoomIndex;
      audioVariantOverrides.value = {};
      audioHistoryByConfig.value = {};
      refreshData();
      return;
    }
    if (document.fullscreenElement === timelineRootRef.value) {
      document.exitFullscreen().catch(() => {});
    }
  },
);

watch(
  () => activeConfig.value,
  (config) => {
    if (!config) return;
    editableDialogue.value = config.dialogue || "";
    selectedVoiceConfigId.value = Number.isFinite(Number(config.voiceConfigId)) ? Number(config.voiceConfigId) : null;
    selectedVoicePresetId.value = config.voicePresetId || "";
    selectedAudioTrack.value = Number(config.audioTrack || 1);
    selectedDialogueTrack.value = Number(config.dialogueTrack || 1);
    if (selectedVoiceConfigId.value) {
      fetchVoicePresets();
    } else {
      voicePresets.value = [];
    }
    const variants = buildAudioVariants(config);
    selectedAudioVariantKey.value = resolveDefaultAudioVariantKey(config, variants);
    if (!activeStoryboardCandidates.value.find((item) => item.id === selectedStoryboardShotId.value)) {
      selectedStoryboardShotId.value = activeStoryboardCandidates.value[0]?.id || null;
    }
  },
);

watch(
  () => activeStoryboardCandidates.value,
  (items) => {
    if (!items.find((item) => item.id === selectedStoryboardShotId.value)) {
      selectedStoryboardShotId.value = items[0]?.id || null;
    }
  },
  { immediate: true },
);

watch(
  () => activeAudioVariants.value,
  (variants) => {
    if (!activeConfig.value) return;
    if (!variants.find((item) => item.key === selectedAudioVariantKey.value)) {
      selectedAudioVariantKey.value = resolveDefaultAudioVariantKey(activeConfig.value, variants);
    }
  },
  { immediate: true },
);

watch(
  () => totalDuration.value,
  () => {
    if (playheadSeconds.value > totalDuration.value) {
      playheadSeconds.value = totalDuration.value;
    }
  },
);

watch(
  () => audioTrackCount.value,
  () => syncTrackStates("audio", audioTrackCount.value),
);

watch(
  () => dialogueTrackCount.value,
  () => syncTrackStates("dialogue", dialogueTrackCount.value),
);

watch(
  () => timelineClips.value,
  (clips) => {
    clips.forEach((clip) => {
      if (clip.config.audioPath) ensureWaveform(clip.config.audioPath);
      if (clip.config.ttsAudioPath) ensureWaveform(clip.config.ttsAudioPath);
    });
  },
  { immediate: true },
);

function syncTrackStates(type: "audio" | "dialogue" | "video", count: number) {
  for (let i = 1; i <= count; i += 1) {
    const key = `${type}-${i}`;
    if (!trackStates.value[key]) {
      trackStates.value[key] = { muted: false, visible: true };
    }
  }
}

async function refreshData() {
  if (!props.scriptId || !props.projectId) return;
  restoreAudioPreferences();
  await Promise.all([store.setCurrentScript(props.scriptId, props.projectId), fetchStoryboardShots()]);
  await fetchVoiceModels();
  if (!activeConfigId.value && orderedConfigs.value.length) {
    activeConfigId.value = orderedConfigs.value[0].id;
  }
  syncTrackStates("video", 1);
  syncTrackStates("audio", audioTrackCount.value);
  syncTrackStates("dialogue", dialogueTrackCount.value);
}

function formatSeconds(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function isMajorTick(tick: number) {
  return Number.isInteger(tick);
}

function isAnchorTick(tick: number) {
  return Number.isInteger(tick) && tick % 5 === 0;
}

function getWaveform(url?: string | null) {
  if (!url) return null;
  return waveformCache.value.get(url) || null;
}

async function ensureWaveform(url: string) {
  if (!url || waveformCache.value.has(url) || waveformLoading.value.has(url)) return;
  waveformLoading.value.add(url);
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const audioContext = new AudioContext();
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    const channelData = decoded.getChannelData(0);
    const samples = new Array(waveformBucketCount).fill(0);
    const blockSize = Math.floor(channelData.length / waveformBucketCount) || 1;
    for (let i = 0; i < waveformBucketCount; i += 1) {
      let max = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      for (let j = start; j < end; j += 1) {
        const value = Math.abs(channelData[j]);
        if (value > max) max = value;
      }
      samples[i] = Math.min(1, max * 2);
    }
    waveformCache.value.set(url, samples);
    audioContext.close();
  } catch {
    waveformCache.value.set(url, []);
  } finally {
    waveformLoading.value.delete(url);
  }
}

function normalizeAudioUrl(url?: string | null) {
  return String(url || "").trim();
}

function persistAudioPreferences() {
  // 不再使用 localStorage 作为业务状态来源，仅保留当前会话内存态
}

function restoreAudioPreferences() {
  // no-op，保留函数是为了兼容现有调用点
}

function pushAudioHistory(configId: number, url?: string | null) {
  const value = normalizeAudioUrl(url);
  if (!value) return;
  const current = audioHistoryByConfig.value[configId] || [];
  if (current.includes(value)) return;
  audioHistoryByConfig.value[configId] = [value, ...current].slice(0, 12);
  persistAudioPreferences();
}

function buildAudioVariants(config: VideoConfig): AudioVariant[] {
  const variants: AudioVariant[] = [];
  const selectedVideo = store.getSelectedResult(config.id);
  if (selectedVideo?.filePath) {
    variants.push({ key: "video-origin", label: "视频原声", source: "video", url: "", persistable: false });
  }
  const audioPath = normalizeAudioUrl(config.audioPath);
  const ttsAudioPath = normalizeAudioUrl(config.ttsAudioPath);
  if (audioPath) {
    variants.push({ key: `audio:${audioPath}`, label: "主音频", source: "external", url: audioPath, persistable: true });
  }
  if (ttsAudioPath) {
    variants.push({ key: `tts:${ttsAudioPath}`, label: "台词TTS", source: "external", url: ttsAudioPath, persistable: true });
  }
  const history = audioHistoryByConfig.value[config.id] || [];
  history.forEach((url, idx) => {
    if (!url || url === audioPath || url === ttsAudioPath) return;
    variants.push({ key: `history:${url}`, label: `历史音频 ${idx + 1}`, source: "external", url, persistable: true });
  });
  return variants;
}

function resolveDefaultAudioVariantKey(config: VideoConfig, variants: AudioVariant[]) {
  const override = audioVariantOverrides.value[config.id];
  if (override?.source === "video") return "video-origin";
  if (override?.source === "external" && override.url) {
    const match = variants.find((item) => item.source === "external" && item.url === override.url);
    if (match) return match.key;
  }
  const audioPath = normalizeAudioUrl(config.audioPath);
  if (audioPath) {
    const audioMatch = variants.find((item) => item.source === "external" && item.url === audioPath);
    if (audioMatch) return audioMatch.key;
  }
  const ttsAudioPath = normalizeAudioUrl(config.ttsAudioPath);
  if (ttsAudioPath) {
    const ttsMatch = variants.find((item) => item.source === "external" && item.url === ttsAudioPath);
    if (ttsMatch) return ttsMatch.key;
  }
  if (variants.find((item) => item.key === "video-origin")) return "video-origin";
  return variants[0]?.key || "";
}

function getAudioPlaybackSource(config: VideoConfig): { source: "video" | "external"; url: string } {
  const override = audioVariantOverrides.value[config.id];
  if (override?.source === "video") return { source: "video", url: "" };
  if (override?.source === "external" && override.url) return { source: "external", url: override.url };
  const audioPath = normalizeAudioUrl(config.audioPath);
  if (audioPath) return { source: "external", url: audioPath };
  const ttsAudioPath = normalizeAudioUrl(config.ttsAudioPath);
  if (ttsAudioPath) return { source: "external", url: ttsAudioPath };
  return { source: "video", url: "" };
}

function shouldMuteVideoByAudioSource(config: VideoConfig) {
  const trackIndex = Number(config.audioTrack || 1);
  const audioTrackEnabled = !isTrackMuted("audio", trackIndex) && isTrackVisible("audio", trackIndex);
  if (!audioTrackEnabled) return false;
  return getAudioPlaybackSource(config).source === "external";
}

function getConfigImageCandidates(config: VideoConfig) {
  const list = [config.startFrame, config.endFrame, ...(Array.isArray(config.images) ? config.images : [])].filter(Boolean) as Array<{
    id?: number;
    filePath?: string;
    prompt?: string;
  }>;
  const ids = list.map((item) => Number(item.id)).filter((id) => Number.isFinite(id) && id > 0);
  const paths = list.map((item) => String(item.filePath || "")).filter(Boolean);
  return { ids, paths };
}

function getStoryboardCandidates(config: VideoConfig) {
  if (!storyboardShots.value.length) return [];
  const { ids, paths } = getConfigImageCandidates(config);
  const idSet = new Set(ids);
  const pathSet = new Set(paths);
  const picked = storyboardShots.value.filter((item) => idSet.has(Number(item.id)) || pathSet.has(String(item.filePath || "")));
  if (!picked.length) {
    const clip = timelineClips.value.find((item) => item.config.id === config.id);
    const fallbackSegmentId = clip ? clip.index + 1 : 0;
    if (fallbackSegmentId > 0) {
      picked.push(...storyboardShots.value.filter((item) => Number(item.segmentId || 0) === fallbackSegmentId));
    }
  }
  const dedupMap = new Map<number, StoryboardShot>();
  picked.forEach((item) => dedupMap.set(Number(item.id), item));
  return Array.from(dedupMap.values());
}

function storyboardOptionLabel(shot: StoryboardShot) {
  const seg = Number(shot.segmentId || 0);
  const idx = Number(shot.shotIndex || 0);
  if (seg > 0 && idx > 0) return `片段${seg}-${idx}镜头`;
  if (seg > 0) return `片段${seg}`;
  return `分镜 ${shot.id}`;
}

async function fetchStoryboardShots() {
  if (!props.scriptId || !props.projectId) return;
  storyboardLoading.value = true;
  try {
    const res = await axios.post("/storyboard/getStoryboard", {
      projectId: props.projectId,
      scriptId: props.scriptId,
    });
    storyboardShots.value = Array.isArray(res.data) ? res.data : [];
  } catch {
    storyboardShots.value = [];
  } finally {
    storyboardLoading.value = false;
  }
}

async function syncConfigFramesFromStoryboard(config: VideoConfig) {
  const shotMap = new Map<number, StoryboardShot>(storyboardShots.value.map((item) => [Number(item.id), item]));
  let changed = false;

  const mapImage = (image: VideoConfig["startFrame"]) => {
    if (!image) return image;
    const shot = shotMap.get(Number(image.id));
    if (!shot) return image;
    const nextFilePath = String(shot.filePath || image.filePath || "");
    const nextPrompt = String(shot.prompt || image.prompt || "");
    if (nextFilePath !== image.filePath || nextPrompt !== image.prompt) {
      changed = true;
      return { ...image, filePath: nextFilePath, prompt: nextPrompt };
    }
    return image;
  };

  const nextStartFrame = mapImage(config.startFrame);
  const nextEndFrame = mapImage(config.endFrame);
  const nextImages = (config.images || []).map((image) => {
    const shot = shotMap.get(Number(image.id));
    if (!shot) return image;
    const nextFilePath = String(shot.filePath || image.filePath || "");
    const nextPrompt = String(shot.prompt || image.prompt || "");
    if (nextFilePath !== image.filePath || nextPrompt !== image.prompt) {
      changed = true;
      return { ...image, filePath: nextFilePath, prompt: nextPrompt };
    }
    return image;
  });

  if (!changed) return false;
  await axios.post("/video/upDateVideoConfig", {
    id: config.id,
    startFrame: nextStartFrame,
    endFrame: nextEndFrame,
    images: nextImages,
  });
  return true;
}

async function linkStoryboardShotToConfigIfNeeded(config: VideoConfig, shot: StoryboardShot) {
  const { ids, paths } = getConfigImageCandidates(config);
  if (ids.length || paths.length) return false;
  const frame = {
    id: Number(shot.id),
    filePath: String(shot.filePath || ""),
    prompt: String(shot.prompt || ""),
  };
  if (!frame.filePath) return false;
  if (config.mode === "multi") {
    await axios.post("/video/upDateVideoConfig", { id: config.id, images: [frame] });
    return true;
  }
  await axios.post("/video/upDateVideoConfig", { id: config.id, startFrame: frame });
  return true;
}

async function regenerateStoryboardForActiveConfig() {
  if (!activeConfig.value || !props.scriptId || !props.projectId) return;
  const targetConfigId = activeConfig.value.id;
  const shot = activeStoryboardCandidates.value.find((item) => item.id === selectedStoryboardShotId.value) || activeStoryboardCandidates.value[0];
  if (!shot) {
    message.warning("当前片段未关联分镜图");
    return;
  }

  storyboardRegenerating.value = true;
  try {
    const payload = {
      id: Number(shot.id),
      segmentId: Number(shot.segmentId || 0),
      title: shot.name || `分镜 ${shot.segmentId || shot.id}`,
      x: Number(shot.x || 0),
      y: Number(shot.y || 0),
      cells:
        Array.isArray(shot.cells) && shot.cells.length
          ? shot.cells
          : [{ id: String(shot.id), src: String(shot.filePath || ""), prompt: String(shot.prompt || "") }],
      fragmentContent: String(shot.intro || shot.prompt || ""),
      assetsTags: Array.isArray(shot.assetsTags) ? shot.assetsTags : [],
      scriptId: props.scriptId,
      projectId: props.projectId,
    };
    await axios.post("/storyboard/generateShotImage", payload);
    message.success("已提交分镜重生成任务");

    let synced = false;
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      await fetchStoryboardShots();
      const latestConfig = orderedConfigs.value.find((item) => item.id === targetConfigId);
      if (!latestConfig) break;
      synced = await syncConfigFramesFromStoryboard(latestConfig);
      if (synced) break;
    }
    if (!synced) {
      const latestConfig = orderedConfigs.value.find((item) => item.id === targetConfigId);
      if (latestConfig) {
        synced = await linkStoryboardShotToConfigIfNeeded(latestConfig, shot);
      }
    }
    if (synced) {
      await refreshData();
      message.success("分镜已回写到当前片段");
    } else {
      message.info("分镜任务已提交，回写延迟可稍后点“刷新分镜”");
    }
  } catch (err: unknown) {
    if (err instanceof Error) message.error(err.message);
    else message.error("分镜重生成失败");
  } finally {
    storyboardRegenerating.value = false;
  }
}

async function applySelectedAudioVariant() {
  if (!activeConfig.value) return;
  const variant = activeAudioVariants.value.find((item) => item.key === selectedAudioVariantKey.value);
  if (!variant) return;

  if (variant.source === "video") {
    audioVariantOverrides.value[activeConfig.value.id] = { source: "video", url: "" };
    persistAudioPreferences();
    refreshPlaybackForActiveClip();
    message.success("已切换为视频原声（当前会话）");
    return;
  }

  try {
    await axios.post("/video/upDateVideoConfig", {
      id: activeConfig.value.id,
      audioPath: variant.url,
    });
    audioVariantOverrides.value[activeConfig.value.id] = { source: "external", url: variant.url };
    persistAudioPreferences();
    pushAudioHistory(activeConfig.value.id, variant.url);
    await refreshData();
    refreshPlaybackForActiveClip();
    message.success("主音频已切换");
  } catch (err: unknown) {
    if (err instanceof Error) message.error(err.message);
    else message.error("主音频切换失败");
  }
}

function selectConfig(config: VideoConfig) {
  activeConfigId.value = config.id;
}

function audioClipsByTrack(trackIndex: number) {
  return timelineClips.value.filter((clip) => Number(clip.config.audioTrack || 1) === trackIndex);
}

function dialogueClipsByTrack(trackIndex: number) {
  return timelineClips.value.filter((clip) => Number(clip.config.dialogueTrack || 1) === trackIndex);
}

function addAudioTrack() {
  audioTrackOverride.value = audioTrackCount.value + 1;
}

function addDialogueTrack() {
  dialogueTrackOverride.value = dialogueTrackCount.value + 1;
}

function toggleTrack(type: "audio" | "dialogue" | "video", trackIndex: number) {
  const key = `${type}-${trackIndex}`;
  const state = trackStates.value[key];
  if (!state) return;
  state.visible = !state.visible;
  refreshPlaybackForActiveClip();
}

function toggleMute(type: "audio" | "dialogue" | "video", trackIndex: number) {
  const key = `${type}-${trackIndex}`;
  const state = trackStates.value[key];
  if (!state) return;
  state.muted = !state.muted;
  refreshPlaybackForActiveClip();
}

function isTrackVisible(type: "audio" | "dialogue" | "video", trackIndex: number) {
  const key = `${type}-${trackIndex}`;
  return trackStates.value[key]?.visible ?? true;
}

function isTrackMuted(type: "audio" | "dialogue" | "video", trackIndex: number) {
  const key = `${type}-${trackIndex}`;
  return trackStates.value[key]?.muted ?? false;
}

function refreshPlaybackForActiveClip() {
  if (previewIndex.value == null) return;
  const clip = timelineClips.value[previewIndex.value];
  if (!clip) return;
  const offset = previewVideoRef.value?.currentTime || 0;
  if (previewVideoRef.value) {
    previewVideoRef.value.muted = isTrackMuted("video", 1) || !isTrackVisible("video", 1) || shouldMuteVideoByAudioSource(clip.config);
  }
  syncAudioTrack(clip, offset, previewPlaying.value);
  syncDialogueTrack(clip, offset, previewPlaying.value);
  syncAuxTracksToMainClock();
}

function shouldIgnoreTimelineSeek(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  return Boolean(
    target.closest(
      ".clipItem, .trackToggle, .ant-btn, .ant-select, .ant-input, .ant-input-affix-wrapper, textarea, input, .timelineInspector, .previewPanel, .editorFloatingActions",
    ),
  );
}

function handleTimelineMouseDown(event: MouseEvent) {
  if (!scrollerRef.value) return;
  if (shouldIgnoreTimelineSeek(event)) return;
  const seconds = updatePlayhead(event);
  seekToTime(seconds, previewPlaying.value);
  const handleMove = (e: MouseEvent) => {
    const nextSeconds = updatePlayhead(e);
    seekToTime(nextSeconds, previewPlaying.value);
  };
  const handleUp = () => {
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleUp);
  };
  window.addEventListener("mousemove", handleMove);
  window.addEventListener("mouseup", handleUp);
}

function handleGlobalSeek(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target || !totalDuration.value) return;
  const rect = target.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const seconds = ratio * totalDuration.value;
  playheadSeconds.value = seconds;
  seekToTime(seconds, previewPlaying.value);
  const handleMove = (e: MouseEvent) => {
    const moveRatio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const moveSeconds = moveRatio * totalDuration.value;
    playheadSeconds.value = moveSeconds;
    seekToTime(moveSeconds, previewPlaying.value);
  };
  const handleUp = () => {
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleUp);
  };
  window.addEventListener("mousemove", handleMove);
  window.addEventListener("mouseup", handleUp);
}

function updatePlayhead(event: MouseEvent) {
  if (!scrollerRef.value) return;
  const rect = scrollerRef.value.getBoundingClientRect();
  const scrollLeft = scrollerRef.value.scrollLeft;
  const x = event.clientX - rect.left + scrollLeft;
  const seconds = Math.max(0, Math.min(totalDuration.value, (x - TRACK_LABEL_WIDTH) / pixelsPerSecond.value));
  playheadSeconds.value = seconds;
  return seconds;
}

function adjustTimelineScrollForZoom(previousPps: number, nextPps: number) {
  if (!scrollerRef.value) return;
  const anchorTime = playheadSeconds.value;
  const previousX = TRACK_LABEL_WIDTH + anchorTime * previousPps;
  const nextX = TRACK_LABEL_WIDTH + anchorTime * nextPps;
  const delta = nextX - previousX;
  scrollerRef.value.scrollLeft = Math.max(0, scrollerRef.value.scrollLeft + delta);
}

function setTimelineZoom(nextIndex: number) {
  const clamped = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, nextIndex));
  if (clamped === zoomIndex.value) return;
  const previousPps = pixelsPerSecond.value;
  zoomIndex.value = clamped;
  requestAnimationFrame(() => {
    adjustTimelineScrollForZoom(previousPps, pixelsPerSecond.value);
  });
}

function zoomInTimeline() {
  setTimelineZoom(zoomIndex.value + 1);
}

function zoomOutTimeline() {
  setTimelineZoom(zoomIndex.value - 1);
}

function resetTimelineZoom() {
  setTimelineZoom(defaultZoomIndex);
}

function handleTimelineWheel(event: WheelEvent) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (event.deltaY < 0) zoomInTimeline();
  if (event.deltaY > 0) zoomOutTimeline();
}

function findClipByTime(time: number) {
  if (!timelineClips.value.length) return { index: 0, offset: 0 };
  for (let i = 0; i < timelineClips.value.length; i += 1) {
    const clip = timelineClips.value[i];
    if (time >= clip.start && time < clip.start + clip.duration) {
      return { index: i, offset: time - clip.start };
    }
  }
  const lastIndex = timelineClips.value.length - 1;
  const last = timelineClips.value[lastIndex];
  return { index: lastIndex, offset: Math.max(0, last.duration - 0.01) };
}

function playFromPlayhead() {
  if (!timelineClips.value.length) return;
  seekToTime(playheadSeconds.value, true);
}

function togglePreviewPlayback() {
  if (previewPlaying.value) {
    pausePreview();
    return;
  }
  playFromPlayhead();
}

function setInspectorSection(section: InspectorSection) {
  activeInspectorSection.value = section;
}

function toggleInspectorPanel() {
  inspectorPanelVisible.value = !inspectorPanelVisible.value;
}

function toggleModalExpanded() {
  isModalExpanded.value = !isModalExpanded.value;
}

async function toggleEditorFullscreen() {
  const target = timelineRootRef.value;
  if (!target) return;
  try {
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }
    await target.requestFullscreen();
    inspectorPanelVisible.value = false;
  } catch {
    message.warning("当前环境不支持编辑器全屏");
  }
}

async function togglePreviewFullscreen() {
  const target = previewPanelRef.value;
  if (!target) return;
  try {
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }
    await target.requestFullscreen();
  } catch {
    message.warning("当前环境不支持全屏预览");
  }
}

function handlePreviewFullscreenChange() {
  const previousEditorFullscreen = isEditorFullscreen.value;
  isPreviewFullscreen.value = document.fullscreenElement === previewPanelRef.value;
  isEditorFullscreen.value = document.fullscreenElement === timelineRootRef.value;
  if (isEditorFullscreen.value && !previousEditorFullscreen) {
    inspectorPanelVisible.value = false;
  }
  if (!isEditorFullscreen.value && previousEditorFullscreen) {
    inspectorPanelVisible.value = true;
  }
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (!showModal.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true'], .ant-select-dropdown, .ant-select-selection-search-input")) return;

  if (event.key === "Tab" && isEditorFullscreen.value) {
    event.preventDefault();
    toggleInspectorPanel();
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (previewPlaying.value) {
      pausePreview();
    } else {
      playFromPlayhead();
    }
    return;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const step = event.shiftKey ? 2 : 0.5;
    const delta = event.key === "ArrowLeft" ? -step : step;
    const nextTime = Math.max(0, Math.min(totalDuration.value, playheadSeconds.value + delta));
    playheadSeconds.value = nextTime;
    seekToTime(nextTime, previewPlaying.value);
    return;
  }

  if ((event.metaKey || event.ctrlKey) && (event.key === "=" || event.key === "+")) {
    event.preventDefault();
    zoomInTimeline();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === "-") {
    event.preventDefault();
    zoomOutTimeline();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === "0") {
    event.preventDefault();
    resetTimelineZoom();
  }
}

function syncAuxMediaClock(media: HTMLAudioElement | null, expectedTime: number, playbackRate: number) {
  if (!media) return;
  media.playbackRate = playbackRate;
  if (media.paused) return;
  if (Math.abs(media.currentTime - expectedTime) > AUX_DRIFT_THRESHOLD) {
    media.currentTime = Math.max(0, expectedTime);
  }
}

function syncAuxTracksToMainClock() {
  if (!previewVideoRef.value || previewIndex.value == null) return;
  const clip = timelineClips.value[previewIndex.value];
  if (!clip) return;
  const expectedTime = Math.max(0, previewVideoRef.value.currentTime);
  const rate = previewVideoRef.value.playbackRate || 1;
  syncAuxMediaClock(previewAudioRef.value, expectedTime, rate);
  syncAuxMediaClock(previewDialogueRef.value, expectedTime, rate);
}

function playClip(index: number, offset: number) {
  if (!previewVideoRef.value) return;
  const clip = timelineClips.value[index];
  if (!clip) return;
  const src = clip.result?.filePath;
  if (!src) {
    playClip(index + 1, 0);
    return;
  }
  previewIndex.value = index;
  previewVideoRef.value.src = src;
  previewVideoRef.value.currentTime = Math.max(0, offset);
  previewVideoRef.value.muted = isTrackMuted("video", 1) || !isTrackVisible("video", 1) || shouldMuteVideoByAudioSource(clip.config);
  previewVideoRef.value.onratechange = syncAuxTracksToMainClock;
  previewVideoRef.value.ontimeupdate = () => {
    if (previewIndex.value == null || !previewVideoRef.value) return;
    const currentClip = timelineClips.value[previewIndex.value];
    if (!currentClip) return;
    playheadSeconds.value = currentClip.start + previewVideoRef.value.currentTime;
    syncAuxTracksToMainClock();
  };
  previewVideoRef.value
    .play()
    .then(() => {
      previewPlaying.value = true;
    })
    .catch(() => {
      previewPlaying.value = false;
    });
  syncAudioTrack(clip, offset, true);
  syncDialogueTrack(clip, offset, true);
}

function seekToTime(seconds: number, autoPlay: boolean) {
  if (!previewVideoRef.value || !timelineClips.value.length) return;
  const { index, offset } = findClipByTime(seconds);
  const clip = timelineClips.value[index];
  if (!clip) return;
  const src = clip.result?.filePath;
  if (!src) {
    // 跳到下一个有视频的片段
    const nextIndex = timelineClips.value.findIndex((item) => item.result?.filePath);
    if (nextIndex >= 0) {
      playheadSeconds.value = timelineClips.value[nextIndex].start;
      seekToTime(playheadSeconds.value, autoPlay);
    }
    return;
  }
  previewIndex.value = index;
  const currentSrc = previewVideoRef.value.src;
  const nextSrc = src;
  const applySeek = () => {
    previewVideoRef.value!.currentTime = Math.max(0, offset);
    previewVideoRef.value!.muted = isTrackMuted("video", 1) || !isTrackVisible("video", 1) || shouldMuteVideoByAudioSource(clip.config);
    previewVideoRef.value!.onratechange = syncAuxTracksToMainClock;
    previewVideoRef.value!.ontimeupdate = () => {
      if (previewIndex.value == null || !previewVideoRef.value) return;
      const currentClip = timelineClips.value[previewIndex.value];
      if (!currentClip) return;
      playheadSeconds.value = currentClip.start + previewVideoRef.value.currentTime;
      syncAuxTracksToMainClock();
    };
    if (autoPlay) {
      previewVideoRef
        .value!.play()
        .then(() => {
          previewPlaying.value = true;
        })
        .catch(() => {
          previewPlaying.value = false;
        });
    } else {
      previewVideoRef.value!.pause();
      previewPlaying.value = false;
    }
    syncAudioTrack(clip, offset, autoPlay);
    syncDialogueTrack(clip, offset, autoPlay);
  };
  if (currentSrc !== nextSrc) {
    previewVideoRef.value.onloadedmetadata = applySeek;
    previewVideoRef.value.src = nextSrc;
    previewVideoRef.value.load();
  } else {
    applySeek();
  }
}

function pausePreview() {
  if (!previewVideoRef.value) return;
  previewVideoRef.value.pause();
  previewAudioRef.value?.pause();
  previewDialogueRef.value?.pause();
  previewPlaying.value = false;
}

function handlePreviewEnded() {
  if (previewIndex.value == null) return;
  const nextIndex = previewIndex.value + 1;
  if (nextIndex >= timelineClips.value.length) {
    previewPlaying.value = false;
    return;
  }
  playClip(nextIndex, 0);
}

function syncAudioTrack(clip: { config: VideoConfig }, offset: number, autoPlay: boolean) {
  const trackIndex = Number(clip.config.audioTrack || 1);
  const shouldPlay = !isTrackMuted("audio", trackIndex) && isTrackVisible("audio", trackIndex);
  const playbackRate = previewVideoRef.value?.playbackRate || 1;
  if (!previewAudioRef.value) {
    previewAudioRef.value = new Audio();
    previewAudioRef.value.preload = "auto";
  }
  previewAudioRef.value.pause();
  if (!shouldPlay) return;
  const source = getAudioPlaybackSource(clip.config);
  if (source.source !== "external" || !source.url) return;
  previewAudioRef.value.src = source.url;
  previewAudioRef.value.currentTime = Math.max(0, offset);
  previewAudioRef.value.playbackRate = playbackRate;
  if (autoPlay) {
    previewAudioRef.value.play().catch(() => {});
  }
}

function syncDialogueTrack(clip: { config: VideoConfig }, offset: number, autoPlay: boolean) {
  const trackIndex = Number(clip.config.dialogueTrack || 1);
  const shouldPlay = !isTrackMuted("dialogue", trackIndex) && isTrackVisible("dialogue", trackIndex);
  const src = clip.config.ttsAudioPath || "";
  const playbackRate = previewVideoRef.value?.playbackRate || 1;
  if (!previewDialogueRef.value) {
    previewDialogueRef.value = new Audio();
    previewDialogueRef.value.preload = "auto";
  }
  previewDialogueRef.value.pause();
  if (!src || !shouldPlay) return;
  previewDialogueRef.value.src = src;
  previewDialogueRef.value.currentTime = Math.max(0, offset);
  previewDialogueRef.value.playbackRate = playbackRate;
  if (autoPlay) {
    previewDialogueRef.value.play().catch(() => {});
  }
}

function moveClip(index: number, delta: number) {
  const list = orderedConfigs.value;
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= list.length) return;
  const current = list[index];
  const target = list[targetIndex];
  const currentSort = Number.isFinite(Number(current.sort)) ? Number(current.sort) : index + 1;
  const targetSort = Number.isFinite(Number(target.sort)) ? Number(target.sort) : targetIndex + 1;
  swapSort(current.id, target.id, currentSort, targetSort);
}

async function swapSort(currentId: number, targetId: number, currentSort: number, targetSort: number) {
  try {
    await Promise.all([
      axios.post("/video/upDateVideoConfig", { id: currentId, sort: targetSort }),
      axios.post("/video/upDateVideoConfig", { id: targetId, sort: currentSort }),
    ]);
    await refreshData();
  } catch (err) {
    message.error("排序更新失败");
  }
}

async function saveOrder() {
  if (!orderedConfigs.value.length) return;
  savingOrder.value = true;
  try {
    await Promise.all(orderedConfigs.value.map((config, idx) => axios.post("/video/upDateVideoConfig", { id: config.id, sort: idx + 1 })));
    message.success("排序已保存");
    await refreshData();
  } catch (err) {
    message.error("保存排序失败");
  } finally {
    savingOrder.value = false;
  }
}

function openVideoDetail() {
  if (!activeConfigId.value) return;
  detailModalShow.value = true;
}

async function refreshConfigStatus() {
  if (!activeConfigId.value || !props.scriptId) return;
  try {
    await store.fetchVideoData(
      props.scriptId,
      store.getResultsByConfigId(activeConfigId.value).map((item) => item.id),
    );
    message.success("已刷新状态");
  } catch (err) {
    message.error("刷新失败");
  }
}

async function fetchVoiceModels() {
  try {
    const res = await axios.post("/setting/getVoiceModelList", { type: "voice" });
    voiceModels.value = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    voiceModels.value = [];
  }
}

async function handleVoiceConfigChange() {
  selectedVoicePresetId.value = "";
  await fetchVoicePresets();
}

async function fetchVoicePresets() {
  if (!selectedVoiceConfigId.value) return;
  try {
    const res = await axios.post("/voice/getVoices", { configId: selectedVoiceConfigId.value });
    const data = res.data || [];
    const list: VoicePresetApiItem[] = Array.isArray(data?.voices) ? data.voices : Array.isArray(data) ? data : [];
    voicePresets.value = list.map((item) => {
      if (typeof item === "string") return { voiceId: item, name: item };
      const voiceId = item.voice_id || item.voiceId || item.id || item.key || "";
      const name = item.name || item.label || item.voice_name || voiceId || "默认音色";
      return { voiceId: String(voiceId), name: String(name) };
    });
    if (!selectedVoicePresetId.value && voicePresets.value.length) {
      selectedVoicePresetId.value = voicePresets.value[0].voiceId;
    }
  } catch (err) {
    voicePresets.value = [];
  }
}

async function updateAudioTrack(value: number) {
  if (!activeConfig.value) return;
  await axios.post("/video/upDateVideoConfig", { id: activeConfig.value.id, audioTrack: value });
  await refreshData();
}

async function updateDialogueTrack(value: number) {
  if (!activeConfig.value) return;
  await axios.post("/video/upDateVideoConfig", { id: activeConfig.value.id, dialogueTrack: value });
  await refreshData();
}

async function saveDialogue() {
  if (!activeConfig.value) return;
  try {
    await axios.post("/video/upDateVideoConfig", {
      id: activeConfig.value.id,
      dialogue: editableDialogue.value,
      voiceConfigId: selectedVoiceConfigId.value,
      voicePresetId: selectedVoicePresetId.value,
    });
    message.success("已保存");
    await refreshData();
  } catch (err) {
    message.error("保存失败");
  }
}

async function generateDialogueAudio() {
  if (!activeConfig.value) return;
  if (!selectedVoiceConfigId.value) {
    message.warning("请选择语音模型");
    return;
  }
  if (!selectedVoicePresetId.value) {
    message.warning("请选择音色");
    return;
  }
  if (!editableDialogue.value.trim()) {
    message.warning("请先输入台词");
    return;
  }
  dialogueGenerating.value = true;
  try {
    const previousAudioPath = activeConfig.value.audioPath || "";
    const previousTtsPath = activeConfig.value.ttsAudioPath || "";
    const res = await axios.post("/voice/preview", {
      configId: selectedVoiceConfigId.value,
      mode: "text",
      voiceId: selectedVoicePresetId.value,
      text: editableDialogue.value.trim(),
    });
    const audioUrl = res.data?.audioUrl || "";
    if (!audioUrl) throw new Error("台词生成失败");
    await axios.post("/video/upDateVideoConfig", {
      id: activeConfig.value.id,
      dialogue: editableDialogue.value.trim(),
      voiceConfigId: selectedVoiceConfigId.value,
      voicePresetId: selectedVoicePresetId.value,
      audioPath: audioUrl,
      ttsAudioPath: audioUrl,
    });
    pushAudioHistory(activeConfig.value.id, previousAudioPath);
    pushAudioHistory(activeConfig.value.id, previousTtsPath);
    pushAudioHistory(activeConfig.value.id, audioUrl);
    audioVariantOverrides.value[activeConfig.value.id] = { source: "external", url: audioUrl };
    persistAudioPreferences();
    message.success("台词音频已生成");
    await refreshData();
  } catch (err: unknown) {
    if (err instanceof Error) message.error(err.message);
    else message.error("生成失败");
  } finally {
    dialogueGenerating.value = false;
  }
}

function triggerAudioFile() {
  audioFileInput.value?.click();
}

async function handleAudioFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file || !activeConfig.value || !props.projectId) return;
  const configId = activeConfig.value.id;
  const previousAudioPath = activeConfig.value.audioPath || "";
  const previousTtsPath = activeConfig.value.ttsAudioPath || "";
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64Data = String(reader.result || "");
      const res = await axios.post("/video/uploadAudio", {
        base64Data,
        fileName: file.name,
        projectId: props.projectId,
      });
      await axios.post("/video/upDateVideoConfig", {
        id: configId,
        audioPath: res.data?.filePath || "",
      });
      const uploadedUrl = String(res.data?.filePath || "");
      pushAudioHistory(configId, previousAudioPath);
      pushAudioHistory(configId, previousTtsPath);
      pushAudioHistory(configId, uploadedUrl);
      if (uploadedUrl) {
        audioVariantOverrides.value[configId] = { source: "external", url: uploadedUrl };
        persistAudioPreferences();
      }
      message.success("音频已上传");
      await refreshData();
    } catch (err: unknown) {
      if (err instanceof Error) message.error(err.message);
      else message.error("上传失败");
    } finally {
      if (audioFileInput.value) audioFileInput.value.value = "";
    }
  };
  reader.readAsDataURL(file);
}

async function clearAudio() {
  if (!activeConfig.value) return;
  try {
    const configId = activeConfig.value.id;
    pushAudioHistory(configId, activeConfig.value.audioPath || "");
    pushAudioHistory(configId, activeConfig.value.ttsAudioPath || "");
    await axios.post("/video/upDateVideoConfig", {
      id: configId,
      audioPath: "",
      ttsAudioPath: "",
    });
    audioVariantOverrides.value[configId] = { source: "video", url: "" };
    persistAudioPreferences();
    message.success("已清除音频");
    await refreshData();
  } catch (err) {
    message.error("清除失败");
  }
}

onMounted(() => {
  if (showModal.value) refreshData();
  document.addEventListener("fullscreenchange", handlePreviewFullscreenChange);
  window.addEventListener("keydown", handleEditorKeydown);
});

onBeforeUnmount(() => {
  previewVideoRef.value?.pause();
  previewAudioRef.value?.pause();
  previewDialogueRef.value?.pause();
  document.removeEventListener("fullscreenchange", handlePreviewFullscreenChange);
  window.removeEventListener("keydown", handleEditorKeydown);
});
</script>

<style scoped lang="scss">
:deep(.timelineEditorModal .ant-modal-title) {
  width: 100%;
}

.timelineHeader {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 24px;

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.timelineBody {
  position: relative;
  margin-top: 8px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.timelineBody.fullscreen {
  margin-top: 0;
}

.timelineBody.fullscreen .timelineBodyContent {
  overflow: hidden;
}

.editorFloatingActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.timelineBodyContent {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 328px;
  gap: 14px;
  align-items: stretch;
  overflow: hidden;
}

.timelineBodyContent.noInspector {
  grid-template-columns: minmax(0, 1fr);
}

.timelineMain {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.previewPanel {
  background: #fff;
  border: 1px solid #dde3ee;
  border-radius: 12px;
  padding: 12px;
  flex-shrink: 0;
}

.previewHeader {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: 8px;
  .previewTitle {
    font-weight: 600;
  }
}

.previewVideo {
  background: #0f172a;
  border-radius: 10px;
  overflow: hidden;
  padding-bottom: 10px;
  .videoPlayer {
    width: 100%;
    height: 240px;
    background: #0f172a;
  }
  .globalProgress {
    padding: 6px 12px 0;
  }
  .globalProgressBar {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    cursor: pointer;
  }
  .globalProgressFill {
    height: 100%;
    background: #22c55e;
    border-radius: 999px;
  }
  .globalProgressHandle {
    position: absolute;
    top: 50%;
    width: 12px;
    height: 12px;
    background: #22c55e;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
  }
}

.previewVideo:fullscreen,
.previewVideo:-webkit-full-screen {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: stretch;
  background: #020617;
  border-radius: 0;
  padding: 20px 28px;
  height: 100vh;
}

.previewVideo:fullscreen .videoPlayer,
.previewVideo:-webkit-full-screen .videoPlayer {
  width: 100%;
  height: 100%;
  max-height: calc(100vh - 108px);
  object-fit: contain;
  background: #020617;
}

.previewVideo:fullscreen .globalProgress,
.previewVideo:-webkit-full-screen .globalProgress {
  width: min(1200px, 100%);
  justify-self: center;
  padding: 8px 0 0;
}

.previewActionBar {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}

.previewActionLeft {
  justify-self: start;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: "JetBrains Mono", "Consolas", monospace;
}

.previewTimeCurrent {
  font-size: 18px;
  color: #0f766e;
  line-height: 1;
}

.previewTimeDivider {
  font-size: 14px;
  color: #6b7280;
}

.previewTimeTotal {
  font-size: 16px;
  color: #1f2937;
  line-height: 1;
}

.previewActionCenter {
  justify-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
}

.previewActionRight {
  justify-self: end;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.zoomControl {
  display: inline-flex;
  align-items: center;
  border: 1px solid #d7dfee;
  border-radius: 8px;
  overflow: hidden;
  background: #f8fbff;
}

.zoomBtn,
.zoomReset {
  border: none;
  background: transparent;
  color: #334155;
  height: 32px;
  min-width: 32px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.zoomBtn:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.zoomReset {
  border-left: 1px solid #d7dfee;
  border-right: 1px solid #d7dfee;
  min-width: 58px;
}

.transportBtn {
  min-width: 86px;
}

:deep(.transportBtn.ant-btn-primary) {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  border-color: #1d4ed8;
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.28);
}

:deep(.previewActionCenter .ant-btn),
:deep(.previewActionRight .ant-btn) {
  min-height: 34px;
}

.timelineScroller {
  background: #fff;
  border: 1px solid #dde3ee;
  border-radius: 12px;
  padding: 16px;
  overflow: auto;
  position: relative;
  min-height: 300px;
  min-width: 0;
  flex: 1;
}

.timelineContent {
  position: relative;
  min-height: 380px;
  padding-bottom: 12px;
}

.ruler {
  position: relative;
  height: 34px;
  border-bottom: 1px solid #d6dfec;
  background: linear-gradient(180deg, #f8fbff 0%, #f4f7fc 100%);
}

.rulerTick {
  position: absolute;
  top: 16px;
  width: 1px;
  height: 18px;
  background: #dbe4f1;
  font-size: 11px;
  color: #637085;
  &.major {
    background: #97a6bc;
    height: 18px;
  }
  &.anchor {
    background: #596b86;
  }
  span {
    position: absolute;
    top: -15px;
    left: 4px;
    font-weight: 600;
    color: #4a5c75;
  }
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ef4444;
  z-index: 5;
  .playheadTime {
    position: absolute;
    top: -24px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    line-height: 1;
    padding: 4px 6px;
    border-radius: 6px;
    background: #ef4444;
    color: #fff;
    font-weight: 600;
    white-space: nowrap;
  }
  .playheadHandle {
    width: 12px;
    height: 12px;
    background: #ef4444;
    border-radius: 999px;
    position: absolute;
    top: -7px;
    left: -5px;
    box-shadow: 0 0 0 2px #fff;
  }
}

.trackGroup {
  margin-top: 14px;
}

.groupHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #2d3a50;
}

.trackLane {
  display: grid;
  grid-template-columns: 100px 1fr;
  align-items: stretch;
  margin-bottom: 10px;
  min-height: 72px;
}

.trackLabel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #4f5f79;
  padding: 8px 8px 8px 0;
  font-weight: 600;
  .trackToggle {
    border: 1px solid #d7dfee;
    background: #f5f7fb;
    color: #4f5f79;
    padding: 3px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.2;
    width: fit-content;
  }
}

.laneContent {
  position: relative;
  height: 76px;
  border-radius: 10px;
  border: 1px solid #dbe3ef;
}

.laneVideo {
  background: #f7fbff;
}

.laneAudio {
  background: #f6fff9;
}

.laneDialogue {
  background: #f7f9ff;
}

.clipItem {
  position: absolute;
  top: 8px;
  bottom: 8px;
  border: 1px solid #ccd7e7;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
  &.active {
    border-color: #2563eb;
    box-shadow: 0 8px 14px rgba(37, 99, 235, 0.24);
    transform: translateY(-1px);
  }
  &.muted {
    opacity: 0.45;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.clipItem.video {
  background: #eaf6ff;
}

.clipItem.audio {
  background: #e8f8ee;
}

.clipItem.dialogue {
  background: #e8eefb;
}

.clipPlaceholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637085;
}

.clipMeta {
  position: absolute;
  bottom: 4px;
  left: 6px;
  font-size: 11px;
  color: rgba(15, 23, 42, 0.86);
  font-weight: 600;
  text-shadow: none;
}

.waveform {
  width: 100%;
  height: 100%;
  opacity: 0.9;
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    width: 100%;
    height: 100%;
  }
  rect {
    fill: rgba(22, 163, 74, 0.65);
  }
}

.clipItem.dialogue .waveform rect {
  fill: rgba(37, 99, 235, 0.64);
}

.waveformPlaceholder {
  width: 100%;
  height: 100%;
  background-image: repeating-linear-gradient(90deg, rgba(100, 116, 139, 0.14) 0, rgba(100, 116, 139, 0.14) 2px, transparent 2px, transparent 6px);
  opacity: 0.6;
}

.timelineInspector {
  border: 1px solid #dde3ee;
  border-radius: 12px;
  background: #fbfcff;
  padding: 12px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
}

.inspectorTitle {
  font-weight: 600;
  margin-bottom: 10px;
  color: #2d3a50;
}

.inspectorSegmentTabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.inspectorSegmentBtn {
  border: 1px solid #d7dfee;
  background: #f5f7fb;
  border-radius: 8px;
  font-size: 12px;
  color: #4f5f79;
  height: 32px;
  cursor: pointer;
  &.active {
    border-color: #2563eb;
    background: #eff6ff;
    color: #1d4ed8;
    font-weight: 600;
  }
}

.inspectorPanel {
  margin-top: 12px;
}

.inspectorSection {
  margin-bottom: 16px;
  .inspectorLabel {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #4f5f79;
  }
  .inspectorRow {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .inspectorTip {
    margin-top: 6px;
    font-size: 12px;
    color: #637085;
  }
}

.inspectorEmpty {
  height: 100%;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637085;
  font-size: 13px;
}

:deep(.timelineInspector .ant-select-selector),
:deep(.timelineInspector .ant-btn) {
  min-height: 34px;
}

.hiddenFile {
  display: none;
}

.audioPlayer {
  width: 100%;
  margin-top: 8px;
}

@media (max-width: 1360px) {
  .timelineBodyContent {
    grid-template-columns: minmax(0, 1fr) 292px;
  }
}

@media (max-width: 980px) {
  .previewActionBar {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .previewActionLeft,
  .previewActionCenter,
  .previewActionRight {
    justify-self: start;
  }
}
</style>
