<template>
  <div class="storyboard-video">
    <!-- 头部 -->
    <div class="header">
      <div class="title">
        <div class="icon-wrapper">
          <i-pic :size="20" class="icon" />
        </div>
        <span>视频配置</span>
        <span v-if="currentConfigs.length" class="count">{{ currentConfigs.length }}</span>
      </div>
      <div v-if="canGenerate" class="actions">
        <button :disabled="!disableBtn" class="generate-btn" @click="modalShow = true">
          <i-video-two :size="18" />
          <span>添加配置</span>
        </button>
        <button :disabled="!disableBtn" class="generate-btn" style="margin-left: 10px" @click="openAiVideoModal">
          <i-magic-wand :size="18" />
          <span>AI视频生成</span>
        </button>
        <button :disabled="!disableBtn" class="generate-btn" style="margin-left: 10px" @click="toggleMultiDeleteMode">
          <span>{{ multiDeleteMode ? "取消多选" : "进入多选删除" }}</span>
        </button>
        <template v-if="multiDeleteMode">
          <button :disabled="!currentConfigs.length" class="generate-btn" style="margin-left: 10px" @click="toggleSelectAllConfigs">
            {{ selectedConfigIds.length === currentConfigs.length ? "取消全选" : "全选" }}
          </button>
          <button :disabled="selectedConfigIds.length === 0" class="generate-btn" style="margin-left: 10px" @click="deleteSelectedConfigs">
            删除选中({{ selectedConfigIds.length }})
          </button>
        </template>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="content">
      <template v-if="currentConfigs.length">
        <div class="video-grid">
          <div
            v-for="(config, index) in currentConfigs"
            :key="config.id"
            class="video-card"
            :class="{ selected: multiDeleteMode && isConfigSelected(config.id) }"
            @click="handleCardClick(config, $event)">
            <!-- 视频编号 -->
            <div class="video-index">
              <input
                v-if="multiDeleteMode"
                type="checkbox"
                :checked="isConfigSelected(config.id)"
                class="multi-checkbox"
                style="margin-right: 8px; cursor: pointer"
                @click.stop="toggleConfigSelection(config.id)" />
              <span>#{{ index + 1 }}</span>
            </div>

            <!-- 封面区域 -->
            <div class="cover-wrapper">
              <!-- 已选择结果且成功：固定显示选中的视频 -->
              <template v-if="getSelectedResult(config.id)?.state === 1">
                <img
                  v-if="getSelectedResult(config.id)?.firstFrame"
                  :src="getSelectedResult(config.id)?.firstFrame"
                  class="cover-image"
                  alt="视频封面" />
                <video
                  v-else-if="getSelectedResult(config.id)?.filePath"
                  :src="getSelectedResult(config.id)?.filePath"
                  class="cover-image"
                  preload="metadata"></video>
                <div v-else class="video-placeholder">
                  <i-film :size="32" />
                  <span>视频</span>
                </div>
                <div class="play-overlay">
                  <div class="play-button">
                    <i-play-one theme="filled" :size="32" fill="#fff" />
                  </div>
                </div>
                <div v-if="getSelectedResult(config.id)?.duration" class="duration-badge">
                  {{ formatDuration(getSelectedResult(config.id)!.duration) }}
                </div>
              </template>

              <!-- 有生成中的结果 - 优先显示新一轮尝试 -->
              <template v-else-if="hasGeneratingResult(config.id)">
                <div class="status-wrapper generating">
                  <div class="loading-spinner"></div>
                  <span class="status-text">正在生成中...</span>
                  <span class="status-hint">{{ getResultCount(config.id) }}个结果</span>
                  <button class="refresh-status-btn" @click.stop="refreshRunningStatus(config.id)">刷新状态</button>
                </div>
              </template>

              <!-- 最新一次尝试失败 -->
              <template v-else-if="shouldShowFailedState(config.id)">
                <div class="status-wrapper failed">
                  <div class="failed-icon">
                    <i-close-one theme="filled" :size="28" fill="#ef4444" />
                  </div>
                  <span class="status-text">生成失败</span>
                  <span class="status-hint" :title="getLatestFailedReason(config.id)">
                    {{ getLatestFailedReason(config.id) || "点击进入查看详情" }}
                  </span>
                </div>
              </template>

              <!-- 未生成/待生成 -->
              <template v-else>
                <div class="status-wrapper pending">
                  <div class="pending-icon">
                    <i-setting-config :size="32" />
                  </div>
                  <span class="status-text">待生成</span>
                  <span class="status-hint">点击进入生成</span>
                </div>
              </template>
            </div>

            <!-- 信息区域 -->
            <div class="info-wrapper">
              <div class="config-info">
                <span class="manufacturer-tag">{{ getManufacturerLabel(config.manufacturer) }}</span>
                <span class="resolution-tag" v-if="config.resolution">{{ config.resolution }}</span>
                <span class="duration-tag">{{ config.duration }}s</span>
              </div>
              <p class="prompt-text">{{ config.prompt || "暂无描述" }}</p>
            </div>

            <!-- 删除按钮 -->
            <button v-if="!multiDeleteMode" class="delete-btn" @click.stop="handleDeleteConfig(config.id)">
              <i-delete :size="16" />
            </button>
          </div>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">
          <i-video-two :size="48" />
        </div>
        <p class="empty-title">暂无视频配置</p>
        <p class="empty-desc">点击上方按钮添加视频配置</p>
      </div>
    </div>

    <!-- 添加配置弹窗 -->
    <newVideo v-if="modalShow && scriptId" v-model="modalShow" :scriptId="scriptId" />

    <!-- 视频详情弹窗 -->
    <videoDetail v-if="detailModalShow" v-model="detailModalShow" :configId="currentConfigId" />
    <storyboardChat
      v-if="aiVideoModalShow && scriptId && currentProjectId"
      v-model="aiVideoModalShow"
      :scriptId="scriptId"
      :projectId="currentProjectId"
      mode="video"
      title="AI视频生成" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { Modal, message } from "ant-design-vue";
import newVideo from "./generateVideo/newVideo.vue";
import videoDetail from "./generateVideo/videoDetail.vue";
import storyboardChat from "./storyboardImage/storyboardChat.vue";
import videoStore, { type VideoConfig, type VideoResult } from "@/stores/video";
import { storeToRefs } from "pinia";
import axios from "@/utils/axios";

const props = defineProps<{
  scriptId: number | null;
  disableBtn: boolean;
  canGenerate: boolean;
}>();

const store = videoStore();
const { currentConfigs, currentProjectId } = storeToRefs(store);

const modalShow = ref(false);
const detailModalShow = ref(false);
const aiVideoModalShow = ref(false);
const currentConfigId = ref<number | null>(null);
const multiDeleteMode = ref(false);
const selectedConfigIds = ref<number[]>([]);

// 厂商标签映射
const manufacturerLabels: Record<string, string> = {
  volcengine: "豆包",
  runninghub: "Sora",
  openAi: "OpenAI",
  t8star: "t8star",
  qingyuntop: "QingyunTop",
  kieai: "KieAI",
};

function getManufacturerLabel(manufacturer: string): string {
  return manufacturerLabels[manufacturer] || manufacturer;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// 获取配置的选中结果
function getSelectedResult(configId: number): VideoResult | null {
  return store.getSelectedResult(configId);
}

function getResultsSorted(configId: number): VideoResult[] {
  return [...store.getResultsByConfigId(configId)].sort((a, b) => b.id - a.id);
}

function getLatestResult(configId: number): VideoResult | null {
  return getResultsSorted(configId)[0] || null;
}

// 检查是否有生成中的结果
function hasGeneratingResult(configId: number): boolean {
  const latest = getLatestResult(configId);
  return latest?.state === 0;
}

function shouldShowFailedState(configId: number): boolean {
  const selected = getSelectedResult(configId);
  if (selected && selected.state === 1) return false;
  const latest = getLatestResult(configId);
  if (!latest || latest.state !== -1) return false;
  return true;
}

function getLatestFailedReason(configId: number): string {
  const results = getResultsSorted(configId);
  const failed = results.find((r) => r.state === -1);
  return failed?.errorReason || "";
}

// 获取结果数量
function getResultCount(configId: number): number {
  return store.getResultsByConfigId(configId).length;
}

function isConfigSelected(configId: number): boolean {
  return selectedConfigIds.value.includes(configId);
}

function toggleConfigSelection(configId: number): void {
  const idx = selectedConfigIds.value.indexOf(configId);
  if (idx === -1) {
    selectedConfigIds.value.push(configId);
  } else {
    selectedConfigIds.value.splice(idx, 1);
  }
}

function handleCardClick(config: VideoConfig, event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const clickedAction = target?.closest(".delete-btn,.multi-checkbox,.refresh-status-btn");
  if (clickedAction) return;

  if (multiDeleteMode.value) {
    toggleConfigSelection(config.id);
    return;
  }

  openDetail(config);
}

function toggleMultiDeleteMode(): void {
  multiDeleteMode.value = !multiDeleteMode.value;
  if (!multiDeleteMode.value) {
    selectedConfigIds.value = [];
  }
}

function toggleSelectAllConfigs(): void {
  if (!multiDeleteMode.value) return;
  const allIds = currentConfigs.value.map((item) => item.id);
  selectedConfigIds.value = selectedConfigIds.value.length === allIds.length ? [] : allIds;
}

async function deleteSelectedConfigs(): Promise<void> {
  if (selectedConfigIds.value.length === 0) {
    message.warning("请先选择要删除的视频配置");
    return;
  }
  Modal.confirm({
    title: "确认批量删除",
    content: `将删除选中的 ${selectedConfigIds.value.length} 条视频配置，是否继续？`,
    okText: "确定",
    cancelText: "取消",
    onOk: async () => {
      const ids = [...selectedConfigIds.value];
      try {
        await store.removeConfig(ids);
        message.success(`删除成功：${ids.length} 条`);
      } catch (error: any) {
        message.error(error?.message || "批量删除失败");
        return;
      }
      selectedConfigIds.value = [];
      multiDeleteMode.value = false;
    },
  });
}

// 打开详情弹窗
function openDetail(config: VideoConfig) {
  currentConfigId.value = config.id;
  detailModalShow.value = true;
}

function openAiVideoModal(): void {
  aiVideoModalShow.value = true;
}

// 删除配置
function handleDeleteConfig(configId: number) {
  Modal.confirm({
    title: "确认删除",
    content: "删除配置后，关联的所有生成结果也会被删除，确定要删除吗？",
    okText: "确定",
    cancelText: "取消",
    onOk: async () => {
      await store.removeConfig(configId);
      message.success("删除成功");
    },
  });
}

async function refreshRunningStatus(configId: number) {
  if (!props.scriptId) {
    message.warning("无效的剧本ID");
    return;
  }
  const runningIds = store
    .getResultsByConfigId(configId)
    .filter((item) => item.state === 0)
    .map((item) => item.id);
  if (runningIds.length === 0) {
    message.info("当前没有生成中的任务");
    return;
  }
  try {
    const res = await axios.post("/video/refreshVideoStatus", {
      scriptId: props.scriptId,
      specifyIds: runningIds,
    });
    const data = res?.data?.data || {};
    await store.fetchVideoData(props.scriptId, runningIds);
    if (data.refreshed > 0 && data.unsupported === data.refreshed) {
      message.warning("当前模型暂不支持远端刷新，已仅刷新本地状态");
    } else {
      message.success("状态已刷新");
    }
  } catch (error: any) {
    message.error(error?.message || "刷新状态失败");
  }
}
</script>

<style lang="scss" scoped>
.storyboard-video {
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: linear-gradient(135deg, #faf5ff 0%, #f0f9ff 50%, #eff6ff 100%);
    border-radius: 16px;
    border: 1px solid rgba(147, 51, 234, 0.1);

    .title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 600;
      font-size: 16px;
      color: #1f2937;

      .icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: linear-gradient(135deg, #9333ea, #7c3aed);
        border-radius: 10px;
        box-shadow: 0 4px 12px rgba(147, 51, 234, 0.3);

        .icon {
          color: #fff;
        }
      }

      .count {
        padding: 2px 10px;
        background: rgba(147, 51, 234, 0.1);
        color: #9333ea;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 500;
      }
    }

    .actions {
      display: flex;
      align-items: center;
    }

    .generate-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: linear-gradient(135deg, #9333ea, #7c3aed);
      color: #fff;
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 14px rgba(147, 51, 234, 0.35);

      &:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(147, 51, 234, 0.45);
      }

      &:active:not(:disabled) {
        transform: translateY(0);
      }

      &:disabled {
        background: #d1d5db;
        box-shadow: none;
        cursor: not-allowed;
      }
    }
  }

  .content {
    margin-top: 24px;

    .video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
    }

    .video-card {
      position: relative;
      background: #fff;
      border-radius: 16px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.3s ease;
      border: 1px solid #f3f4f6;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);

      &:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
        border-color: rgba(147, 51, 234, 0.2);

        .play-overlay {
          opacity: 1;
          z-index: 9999999999;
        }

        .cover-image {
          transform: scale(1.05);
        }

        .delete-btn {
          opacity: 1;
          z-index: 999999999999;
        }
      }

      &.selected {
        border-color: #9333ea;
        box-shadow: 0 0 0 2px rgba(147, 51, 234, 0.2);
      }

      .video-index {
        position: absolute;
        top: 10px;
        left: 10px;
        min-width: 24px;
        height: 24px;
        padding: 0 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(147, 51, 234, 0.9);
        border-radius: 6px;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        z-index: 10;
        display: inline-flex;
        align-items: center;
      }

      .delete-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(239, 68, 68, 0.9);
        border: none;
        border-radius: 8px;
        color: #fff;
        cursor: pointer;
        opacity: 0;
        transition: all 0.2s ease;
        z-index: 10;

        &:hover {
          background: #dc2626;
          transform: scale(1.1);
        }
      }

      .cover-wrapper {
        position: relative;
        width: 100%;
        height: 180px;
        overflow: hidden;
        background: linear-gradient(135deg, #f9fafb, #f3f4f6);

        .cover-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.4s ease;
        }

        .play-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;

          .play-button {
            width: 60px;
            height: 60px;
            background: rgba(147, 51, 234, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
            transition: transform 0.2s ease;

            &:hover {
              transform: scale(1.1);
            }
          }
        }

        .duration-badge {
          position: absolute;
          bottom: 10px;
          right: 10px;
          padding: 4px 10px;
          background: rgba(0, 0, 0, 0.75);
          color: #fff;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          backdrop-filter: blur(4px);
        }

        .status-badge {
          position: absolute;
          top: 10px;
          left: 10px;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;

          &.success {
            background: rgba(34, 197, 94, 0.9);
            color: #fff;
          }
        }

        .status-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 12px;

          &.generating {
            .loading-spinner {
              width: 40px;
              height: 40px;
              border: 3px solid #e5e7eb;
              border-top-color: #9333ea;
              border-radius: 50%;
              animation: spin 1s linear infinite;
            }

            .status-text {
              color: #6b7280;
              font-size: 14px;
              font-weight: 500;
            }

            .status-hint {
              color: #9ca3af;
              font-size: 12px;
            }

            .refresh-status-btn {
              margin-top: 8px;
              padding: 4px 10px;
              font-size: 12px;
              border: 1px solid #8f56ff;
              border-radius: 12px;
              background: #fff;
              color: #7c3aed;
              cursor: pointer;
            }
          }

          &.pending {
            .pending-icon {
              width: 50px;
              height: 50px;
              background: linear-gradient(135deg, #f3e8ff, #e9d5ff);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #9333ea;
            }

            .status-text {
              color: #6b7280;
              font-size: 14px;
              font-weight: 500;
            }

            .status-hint {
              color: #9ca3af;
              font-size: 12px;
            }
          }

          &.failed {
            .failed-icon {
              width: 50px;
              height: 50px;
              background: rgba(239, 68, 68, 0.08);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
            }

            .status-text {
              color: #ef4444;
              font-size: 14px;
              font-weight: 600;
            }

            .status-hint {
              color: #9ca3af;
              font-size: 12px;
              max-width: 220px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
          }
        }
      }

      .info-wrapper {
        padding: 16px;

        .config-info {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
          flex-wrap: wrap;

          .manufacturer-tag,
          .resolution-tag,
          .duration-tag {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
          }

          .manufacturer-tag {
            background: rgba(147, 51, 234, 0.1);
            color: #9333ea;
          }

          .resolution-tag {
            background: rgba(59, 130, 246, 0.1);
            color: #3b82f6;
          }

          .duration-tag {
            background: rgba(34, 197, 94, 0.1);
            color: #22c55e;
          }
        }

        .prompt-text {
          margin: 0;
          font-size: 14px;
          color: #4b5563;
          line-height: 1.6;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      background: linear-gradient(135deg, #fafafa, #f5f5f5);
      border-radius: 16px;
      border: 2px dashed #e5e7eb;

      .empty-icon {
        width: 80px;
        height: 80px;
        background: linear-gradient(135deg, #f3e8ff, #e9d5ff);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9333ea;
        margin-bottom: 20px;
      }

      .empty-title {
        margin: 0 0 8px;
        font-size: 18px;
        font-weight: 600;
        color: #374151;
      }

      .empty-desc {
        margin: 0;
        font-size: 14px;
        color: #9ca3af;
      }
    }
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
