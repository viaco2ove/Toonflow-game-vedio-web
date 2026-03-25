<template>
  <a-modal v-model:open="modalVisible" title="视频详情" width="90vw" :style="{ top: '20px' }" :footer="null" destroyOnClose>
    <div class="video-detail" v-if="config">
      <!-- 左侧：配置信息和生成按钮 -->
      <div class="left-panel">
        <div class="config-section">
          <h3 class="section-title">配置信息</h3>
          <!-- 使用公共组件进行配置编辑 -->
          <VideoConfigForm
            v-if="editableConfig"
            :config="editableConfig"
            :script-id="config.scriptId"
            :editable="true"
            :manufacturer-disabled="false"
            @change="handleConfigFormChange" />
        </div>

        <div class="script-section">
          <h3 class="section-title">剧本参考</h3>
          <div class="script-meta" v-if="scriptTitle">{{ scriptTitle }}</div>
          <div class="script-body" :class="{ loading: scriptLoading }">
            <div v-if="scriptLoading" class="script-loading">
              <div class="loading-spinner"></div>
              <span>加载剧本中...</span>
            </div>
            <div v-else class="script-content">{{ scriptContent || "暂无剧本内容" }}</div>
          </div>
        </div>

        <!-- 生成按钮 -->
        <div class="action-section">
          <a-button type="primary" size="large" block :loading="isGenerating" @click="handleGenerate">
            <template #icon><i-video-two /></template>
            生成视频
          </a-button>
          <p class="action-hint">每次生成可能产生不同的结果，可多次尝试</p>
        </div>
      </div>

      <!-- 右侧：生成结果列表 -->
      <div class="right-panel">
        <div class="result-toolbar">
          <h3 class="section-title">
            生成结果
            <span class="result-count" v-if="results.length">{{ results.length }}个</span>
          </h3>
          <div class="result-filters">
            <button
              v-for="item in resultFilterOptions"
              :key="item.key"
              class="result-filter-btn"
              :class="{ active: resultFilter === item.key }"
              @click="resultFilter = item.key">
              <span>{{ item.label }}</span>
              <span class="num">{{ resultCountByFilter(item.key) }}</span>
            </button>
            <a-button size="small" :loading="refreshingRunningResults" :disabled="runningResultIds.length === 0" @click="refreshAllRunningResults">
              刷新生成中
            </a-button>
          </div>
        </div>

        <div class="results-list" v-if="displayResults.length">
          <div
            v-for="result in displayResults"
            :key="result.id"
            class="result-card"
            :class="{
              selected: config.selectedResultId === result.id,
              success: result.state === 1,
              generating: result.state === 0,
              failed: result.state === -1,
              selectable: result.state === 1,
              nonSelectable: result.state !== 1,
            }"
            @click="result.state === 1 && handleSelectResult(result)">
            <!-- 成功状态 -->
            <template v-if="result.state === 1">
              <div class="video-cover" @click.stop="playVideo(result)">
                <img v-if="result.firstFrame" :src="result.firstFrame" alt="视频封面" />
                <video v-else-if="result.filePath" :src="result.filePath" preload="metadata"></video>
                <div v-else class="video-placeholder">
                  <i-film :size="32" />
                  <span>视频</span>
                </div>
                <div class="play-overlay">
                  <i-play-one theme="filled" :size="24" fill="#fff" />
                </div>
                <div class="duration-badge" v-if="result.duration">
                  {{ formatDuration(result.duration) }}
                </div>
              </div>
              <div class="result-actions">
                <a-button v-if="config.selectedResultId !== result.id" type="primary" size="small" @click.stop="handleSelectResult(result)">
                  选择此视频
                </a-button>
                <span v-else class="selected-badge">
                  <i-check-one theme="filled" :size="14" />
                  已选择
                </span>
              </div>
            </template>

            <!-- 生成中状态 -->
            <template v-else-if="result.state === 0">
              <div class="status-cover generating clickable" @click.stop="handleRefreshResult(result.id)">
                <div class="loading-spinner"></div>
                <span>生成中...</span>
                <span class="refresh-hint">{{ refreshingResultIds.includes(result.id) ? "刷新中..." : "点击刷新状态" }}</span>
              </div>
            </template>

            <!-- 失败状态 -->
            <template v-else>
              <a-tooltip :title="result.errorReason || '生成失败'">
                <div class="status-cover failed">
                  <i-close-one theme="filled" :size="24" fill="#ef4444" />
                  <span>生成失败</span>
                </div>
              </a-tooltip>
            </template>
          </div>
        </div>

        <!-- 空状态 -->
        <div class="empty-results" v-else>
          <div class="empty-icon">
            <i-film :size="48" />
          </div>
          <p class="empty-title">{{ emptyResultTitle }}</p>
          <p class="empty-desc">{{ emptyResultDesc }}</p>
        </div>
      </div>
    </div>

    <!-- 视频播放弹窗 -->
    <a-modal v-model:open="videoPlayerVisible" :title="null" :footer="null" width="800px" centered destroyOnClose wrapClassName="video-player-modal">
      <div class="video-player-content">
        <video v-if="currentPlayVideo" ref="videoRef" :src="currentPlayVideo.filePath" controls autoplay class="video-element" />
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import videoStore, { type VideoResult } from "@/stores/video";
import { storeToRefs } from "pinia";
import axios from "@/utils/axios";
import { VideoConfigForm, type VideoConfigData, getModelList, hasModelConfig, isModeSupported } from "@/components/videoConfig";

type DraftVideoConfig = VideoConfigData & {
  scriptId?: number;
  selectedResultId?: number | null;
  selectedResultState?: number;
};
type ResultFilter = "all" | "success" | "running" | "failed";
type PartScriptItem = {
  id?: number;
  content?: string;
  name?: string;
};

const props = defineProps<{
  configId: number | null;
  draftConfig?: DraftVideoConfig | null;
}>();
const emit = defineEmits<{
  (e: "draftChange", config: DraftVideoConfig): void;
  (e: "draftGenerate", config: DraftVideoConfig): void;
}>();

const modalVisible = defineModel<boolean>({});
const store = videoStore();
const { videoConfigs, currentProjectId } = storeToRefs(store);
const isDraftMode = computed(() => Boolean(props.draftConfig));

const isGenerating = ref(false);
const videoPlayerVisible = ref(false);
const currentPlayVideo = ref<VideoResult | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const scriptContent = ref("");
const scriptTitle = ref("");
const scriptLoading = ref(false);
const refreshingResultIds = ref<number[]>([]);
const refreshingRunningResults = ref(false);
const resultFilter = ref<ResultFilter>("all");

// 可编辑配置（将 VideoConfig 转换为 VideoConfigData 格式）
const editableConfig = ref<VideoConfigData | null>(null);
const isModeAvailable = computed(() => {
  if (!editableConfig.value) return true;
  if (!hasModelConfig(editableConfig.value.manufacturer, editableConfig.value.model)) return true;
  return isModeSupported(editableConfig.value.manufacturer, editableConfig.value.model, editableConfig.value.mode);
});

// 当前配置
const config = computed(() => {
  if (isDraftMode.value && props.draftConfig) {
    return {
      ...props.draftConfig,
      id: Number(props.draftConfig.id || props.configId || 0),
      scriptId: Number(props.draftConfig.scriptId || 0),
      selectedResultId: props.draftConfig.selectedResultId ?? null,
    };
  }

  if (!props.configId) return null;

  return videoConfigs.value.find((c) => c.id === props.configId) || null;
});

// 当前配置的所有结果
const results = computed(() => {
  if (!props.configId) return [];
  return store.getResultsByConfigId(Number(props.configId));
});
const resultFilterOptions: Array<{ key: ResultFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "success", label: "成功" },
  { key: "running", label: "生成中" },
  { key: "failed", label: "失败" },
];
const displayResults = computed(() => {
  const sorted = [...results.value].sort((a, b) => b.id - a.id);
  if (resultFilter.value === "all") return sorted;
  if (resultFilter.value === "success") return sorted.filter((item) => item.state === 1);
  if (resultFilter.value === "running") return sorted.filter((item) => item.state === 0);
  return sorted.filter((item) => item.state === -1);
});
const runningResultIds = computed(() => results.value.filter((item) => item.state === 0).map((item) => item.id));
const emptyResultTitle = computed(() => (resultFilter.value === "all" ? "暂无生成结果" : "当前筛选下暂无结果"));
const emptyResultDesc = computed(() => (resultFilter.value === "all" ? "点击左侧按钮开始生成视频" : "可切换筛选查看其它状态"));

watch(modalVisible, (v) => {
  if (v) {
    resultFilter.value = "all";
    getModelList();
  }
});

async function loadScriptContent() {
  const scriptId = Number(config.value?.scriptId || props.draftConfig?.scriptId || 0);
  const projectId = Number(config.value?.projectId || currentProjectId.value || 0);
  if (!scriptId || !projectId) {
    scriptContent.value = "";
    scriptTitle.value = "";
    return;
  }

  scriptLoading.value = true;
  try {
    const { data } = await axios.post("/outline/getPartScript", { projectId });
    const list = Array.isArray(data) ? (data as PartScriptItem[]) : [];
    const target = list.find((item) => Number(item?.id) === scriptId);
    scriptContent.value = String(target?.content || "");
    scriptTitle.value = target?.name ? `剧本：${target.name}` : `剧本：第${scriptId}集`;
  } catch (error) {
    console.error("获取剧本失败:", error);
    scriptContent.value = "";
    scriptTitle.value = "";
  } finally {
    scriptLoading.value = false;
  }
}
// 监听配置变化，初始化可编辑配置
watch(
  config,
  (newConfig) => {
    if (newConfig) {
      editableConfig.value = {
        id: newConfig.id,
        manufacturer: newConfig.manufacturer,
        model: newConfig.model,
        aiConfigId: newConfig.aiConfigId,
        mode: newConfig.mode,
        startFrame: newConfig.startFrame,
        endFrame: newConfig.endFrame,
        images: newConfig.images ? [...newConfig.images] : [],
        resolution: newConfig.resolution,
        duration: newConfig.duration,
        prompt: newConfig.prompt,
        audioEnabled: newConfig.audioEnabled,
      };
    } else {
      editableConfig.value = null;
    }
  },
  { immediate: true },
);

watch(
  () => [modalVisible.value, config.value?.scriptId, config.value?.projectId, props.draftConfig?.scriptId],
  ([visible]) => {
    if (visible) {
      void loadScriptContent();
    }
  },
  { immediate: true },
);

// 配置表单变更处理
async function handleConfigFormChange(updatedConfig: VideoConfigData) {
  // 更新可编辑配置
  editableConfig.value = updatedConfig;

  if (isDraftMode.value && props.draftConfig) {
    emit("draftChange", {
      ...props.draftConfig,
      ...updatedConfig,
      id: Number(props.configId || props.draftConfig.id || 0),
      scriptId: Number(props.draftConfig.scriptId || 0),
    });
    return;
  }

  if (!props.configId || !config.value) return;

  // 更新本地 store（包括图片变更）
  store.updateConfigFull(props.configId, {
    aiConfigId: updatedConfig.aiConfigId,
    manufacturer: updatedConfig.manufacturer,
    model: updatedConfig.model,
    resolution: updatedConfig.resolution,
    duration: updatedConfig.duration,
    prompt: updatedConfig.prompt,
    startFrame: updatedConfig.startFrame,
    endFrame: updatedConfig.endFrame,
    images: updatedConfig.images,
    mode: updatedConfig.mode,
    audioEnabled: updatedConfig.audioEnabled,
  });

  // 调用后端接口更新配置
  try {
    await axios.post("/video/upDateVideoConfig", {
      id: props.configId,
      aiConfigId: updatedConfig.aiConfigId,
      resolution: updatedConfig.resolution,
      duration: updatedConfig.duration,
      prompt: updatedConfig.prompt,
      mode: updatedConfig.mode,
      startFrame: updatedConfig.startFrame,
      endFrame: updatedConfig.endFrame,
      images: updatedConfig.images,
      audioEnabled: updatedConfig.audioEnabled,
    });
  } catch (error: unknown) {
    console.error("更新配置失败:", error);
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// 生成视频
async function handleGenerate() {
  if (!isModeAvailable.value) {
    message.warning("当前模型不支持该模式，请先更换模式或更换模型");
    return;
  }
  if (isDraftMode.value && props.draftConfig && editableConfig.value) {
    if (Number(props.draftConfig?.selectedResultState || 0) === 0) {
      message.warning("当前配置正在生成中，请先等待或点击“刷新状态”");
      return;
    }
    if (results.value.some((item) => item.state === 0)) {
      message.warning("当前配置已有生成中的任务，请先等待或点击“刷新状态”");
      return;
    }
    isGenerating.value = true;
    try {
      const nextConfig = {
        ...props.draftConfig,
        ...editableConfig.value,
        id: Number(props.configId || props.draftConfig.id || 0),
        scriptId: Number(props.draftConfig.scriptId || 0),
      };
      emit("draftGenerate", nextConfig);
      const sid = Number(nextConfig.scriptId || 0);
      if (sid > 0) {
        setTimeout(() => {
          void store.fetchVideoData(sid);
        }, 600);
        setTimeout(() => {
          void store.fetchVideoData(sid);
        }, 1800);
        setTimeout(() => {
          void store.fetchVideoData(sid);
        }, 3600);
      }
    } finally {
      isGenerating.value = false;
    }
    return;
  }

  if (!props.configId) return;

  if (results.value.some((item) => item.state === 0)) {
    message.warning("当前配置已有生成中的任务，请先等待或点击“刷新状态”");
    return;
  }

  isGenerating.value = true;
  try {
    await store.generateVideo(props.configId);
    message.success("视频生成任务已提交");
    // 提交任务后立即刷新一次，尽快在右侧看到“生成中”
    if (config.value?.scriptId) {
      await store.fetchVideoData(config.value.scriptId);
      // 任务落库存在轻微延迟，补一次延迟刷新
      setTimeout(() => {
        void store.fetchVideoData(config.value!.scriptId);
      }, 1200);
    }
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : "生成失败");
  } finally {
    isGenerating.value = false;
  }
}

async function handleRefreshResult(resultId: number) {
  const scriptId = Number(config.value?.scriptId || props.draftConfig?.scriptId || 0);
  if (!scriptId || !resultId) {
    message.warning("无效的刷新参数");
    return;
  }
  if (refreshingResultIds.value.includes(resultId)) {
    return;
  }
  refreshingResultIds.value = [...refreshingResultIds.value, resultId];
  try {
    const data = await store.refreshRemoteStatus(scriptId, [resultId]);
    if (data.refreshed > 0 && data.unsupported === data.refreshed) {
      message.warning("当前模型暂不支持远端刷新");
    } else if (data.success > 0) {
      message.success("远端状态已刷新");
    } else if (data.failed > 0) {
      message.warning("远端已返回失败状态");
    } else {
      message.info("远端任务仍在处理中");
    }
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : "刷新状态失败");
  } finally {
    refreshingResultIds.value = refreshingResultIds.value.filter((id) => id !== resultId);
  }
}

function resultCountByFilter(filter: ResultFilter) {
  if (filter === "all") return results.value.length;
  if (filter === "success") return results.value.filter((item) => item.state === 1).length;
  if (filter === "running") return results.value.filter((item) => item.state === 0).length;
  return results.value.filter((item) => item.state === -1).length;
}

async function refreshAllRunningResults() {
  const scriptId = Number(config.value?.scriptId || props.draftConfig?.scriptId || 0);
  const ids = [...runningResultIds.value];
  if (!scriptId || ids.length === 0) {
    message.info("当前没有生成中的任务");
    return;
  }
  if (refreshingRunningResults.value) return;

  refreshingRunningResults.value = true;
  try {
    const data = await store.refreshRemoteStatus(scriptId, ids);
    if (data.refreshed > 0 && data.unsupported === data.refreshed) {
      message.warning("当前模型暂不支持远端刷新");
    } else if (data.success > 0) {
      message.success(`已刷新 ${data.success} 个任务`);
    } else if (data.failed > 0) {
      message.warning("部分任务已失败，请查看失败原因");
    } else {
      message.info("远端任务仍在处理中");
    }
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : "刷新状态失败");
  } finally {
    refreshingRunningResults.value = false;
  }
}

// 选择结果
async function handleSelectResult(result: VideoResult) {
  if (result.state !== 1 || !props.configId) return;

  // 更新本地 store
  store.selectResult(props.configId, result.id);
  if (isDraftMode.value && props.draftConfig) {
    emit("draftChange", {
      ...props.draftConfig,
      id: Number(props.configId || props.draftConfig.id || 0),
      scriptId: Number(props.draftConfig.scriptId || 0),
      selectedResultId: result.id,
      selectedResultFirstFrame: result.firstFrame || "",
      selectedResultFilePath: result.filePath || "",
      selectedResultDuration: result.duration || 0,
    });
  }

  // 调用后端接口更新选中结果
  try {
    await axios.post("/video/upDateVideoConfig", {
      id: props.configId,
      selectedResultId: result.id,
    });
    message.success("已选择此视频");
  } catch (error: unknown) {
    message.error("选择失败");
    console.error("更新选中结果失败:", error);
  }
}

// 播放视频
function playVideo(result: VideoResult) {
  if (result.state !== 1 || !result.filePath) return;
  currentPlayVideo.value = result;
  videoPlayerVisible.value = true;
}

// 关闭播放器时暂停视频
watch(videoPlayerVisible, (visible) => {
  if (!visible && videoRef.value) {
    videoRef.value.pause();
    currentPlayVideo.value = null;
  }
});
onMounted(() => {
  getModelList();
});
</script>

<style lang="scss" scoped>
.video-detail {
  display: flex;
  gap: 24px;
  height: 88vh;
  overflow: auto;

  .left-panel {
    width: 450px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;

    .config-section {
      background: #f9fafb;
      border-radius: 12px;
      padding: 20px;

      .section-title {
        margin: 0 0 16px;
        font-size: 16px;
        font-weight: 600;
        color: #1f2937;
      }
    }

    .action-section {
      .action-hint {
        margin: 10px 0 0;
        font-size: 12px;
        color: #9ca3af;
        text-align: center;
      }
    }

    .script-section {
      background: #f9fafb;
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;

      .script-meta {
        font-size: 12px;
        color: #6b7280;
      }

      .script-body {
        min-height: 140px;
        max-height: 260px;
        overflow: auto;
        background: #fff;
        border-radius: 10px;
        border: 1px solid #e5e7eb;
        padding: 12px;
        font-size: 12px;
        color: #374151;
        line-height: 1.6;
        white-space: pre-wrap;

        &.loading {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .script-loading {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #9ca3af;

          .loading-spinner {
            width: 18px;
            height: 18px;
            border: 2px solid rgba(37, 99, 235, 0.2);
            border-top-color: #2563eb;
            border-radius: 50%;
            animation: spin 0.9s linear infinite;
          }
        }
      }
    }
  }

  .right-panel {
    flex: 1;
    min-width: 0;

    .result-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;

      .result-count {
        padding: 2px 10px;
        background: rgba(37, 99, 235, 0.1);
        color: #1d4ed8;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
      }
    }

    .result-filters {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .result-filter-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 30px;
      padding: 0 10px;
      border-radius: 999px;
      border: 1px solid #dbe3ef;
      background: #fff;
      color: #4f5f79;
      font-size: 12px;
      cursor: pointer;

      .num {
        min-width: 18px;
        text-align: center;
        font-weight: 600;
        color: #637085;
      }

      &.active {
        border-color: #2563eb;
        background: #eff6ff;
        color: #1d4ed8;
      }
    }

    .results-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;

      .result-card {
        background: #fff;
        border-radius: 12px;
        overflow: hidden;
        border: 2px solid transparent;
        transition: all 0.2s ease;
        cursor: default;

        &.selectable {
          cursor: pointer;
        }

        &:hover {
          border-color: rgba(37, 99, 235, 0.28);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        &.nonSelectable:hover {
          border-color: transparent;
          box-shadow: none;
        }

        .video-cover {
          position: relative;
          width: 100%;
          height: 140px;
          overflow: hidden;

          img,
          video {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .video-placeholder {
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #dbeafe, #bfdbfe);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: #1d4ed8;

            span {
              font-size: 13px;
              font-weight: 500;
            }
          }

          .play-overlay {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease;
          }

          &:hover .play-overlay {
            opacity: 1;
          }

          .duration-badge {
            position: absolute;
            bottom: 8px;
            right: 8px;
            padding: 2px 8px;
            background: rgba(0, 0, 0, 0.75);
            color: #fff;
            border-radius: 4px;
            font-size: 11px;
          }
        }

        .result-actions {
          padding: 12px;
          display: flex;
          justify-content: center;

          .selected-badge {
            display: flex;
            align-items: center;
            gap: 4px;
            color: #1d4ed8;
            font-size: 13px;
            font-weight: 500;
          }
        }

        .status-cover {
          height: 140px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;

          &.generating {
            background: linear-gradient(135deg, #dbeafe, #bfdbfe);

            .loading-spinner {
              width: 32px;
              height: 32px;
              border: 3px solid #e5e7eb;
              border-top-color: #2563eb;
              border-radius: 50%;
              animation: spin 1s linear infinite;
            }

            span {
              color: #1d4ed8;
              font-size: 13px;
            }
          }

          &.failed {
            background: #fef2f2;

            span {
              color: #ef4444;
              font-size: 13px;
            }
          }
        }
      }
    }

    .empty-results {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      background: #f9fafb;
      border-radius: 12px;
      border: 2px dashed #e5e7eb;

      .empty-icon {
        width: 80px;
        height: 80px;
        background: linear-gradient(135deg, #dbeafe, #bfdbfe);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #1d4ed8;
        margin-bottom: 16px;
      }

      .empty-title {
        margin: 0 0 8px;
        font-size: 16px;
        font-weight: 600;
        color: #374151;
      }

      .empty-desc {
        margin: 0;
        font-size: 13px;
        color: #9ca3af;
      }
    }
  }
}

.video-player-content {
  .video-element {
    width: 100%;
    max-height: 70vh;
    display: block;
    background: #000;
    border-radius: 8px;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
